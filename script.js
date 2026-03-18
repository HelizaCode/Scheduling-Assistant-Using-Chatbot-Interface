// SECTION: State & Utilities
const state = {
  events: [], // { id, title, start: Date, end: Date, sourceText }
  suggestions: [], // { id, start, end, reason }
  view: 'day',
  currentDate: new Date(),
};

let idCounter = 1;

// Helpers
function cloneDate(d) {
  return new Date(d.getTime());
}

function startOfDay(d) {
  const x = cloneDate(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun
  const diff = (day === 0 ? -6 : 1) - day; // Monday as start
  x.setDate(x.getDate() + diff);
  return x;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function formatTime(d) {
  const opts = { hour: 'numeric', minute: '2-digit' };
  return d.toLocaleTimeString([], opts);
}

function formatRangeLabel(date, view) {
  if (view === 'day') {
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  const start = startOfWeek(date);
  const end = addMinutes(start, 6 * 24 * 60);
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} 
– ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// Time parsing: simple, not exhaustive
function parseWhen(text) {
  const now = new Date();
  let base = startOfDay(now);

  if (/tomorrow/i.test(text)) {
    base.setDate(base.getDate() + 1);
  } else if (/next week/i.test(text)) {
    base = addMinutes(startOfWeek(now), 7 * 24 * 60);
  } else if (/next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(text)) {
    const [, dayName] = text.match(/next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
    const target = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(dayName.toLowerCase());
    let d = cloneDate(now);
    d.setDate(d.getDate() + 7);
    while (d.getDay() !== target) d.setDate(d.getDate() + 1);
    base = startOfDay(d);
  } else if (/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(text)) {
    const dayName = text.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)[1];
    const target = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(dayName.toLowerCase());
    let d = cloneDate(now);
    while (d.getDay() !== target) d.setDate(d.getDate() + 1);
    base = startOfDay(d);
  }

  // time of day
  let hour = 9;
  let minute = 0;
  let durationMin = 60;

  if (/morning/i.test(text)) {
    hour = 9;
    durationMin = 60;
  } else if (/afternoon/i.test(text)) {
    hour = 14;
  } else if (/evening/i.test(text)) {
    hour = 18;
  }

  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3];
    if (ampm) {
      if (/pm/i.test(ampm) && hour < 12) hour += 12;
      if (/am/i.test(ampm) && hour === 12) hour = 0;
    }
  }

  const durMatch = text.match(/(\d{1,2})\s*(h|hr|hrs|hour|hours)/i);
  if (durMatch) {
    durationMin = parseInt(durMatch[1], 10) * 60;
  } else {
    const minsMatch = text.match(/(\d{1,3})\s*(min|mins|minutes)/i);
    if (minsMatch) durationMin = parseInt(minsMatch[1], 10);
  }

  const start = cloneDate(base);
  start.setHours(hour, minute, 0, 0);
  const end = addMinutes(start, durationMin);
  return { start, end, durationMin };
}

function inferTitle(text) {
  const lower = text.toLowerCase();
  if (lower.startsWith('add ')) return text.slice(4).trim();
  if (lower.startsWith('schedule ')) return text.slice(9).trim();
  if (lower.startsWith('create ')) return text.slice(7).trim();
  // crude: remove common time words
  return text
    .replace(/(today|tomorrow|next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi, '')
    .replace(/(at|from|between|to|am|pm|\d{1,2}:?\d{0,2})/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}

// SECTION: Rendering
const chatWindow = document.getElementById('chat-window');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const quickButtons = document.querySelectorAll('.pill-button[data-command]');

const scheduleRangeEl = document.getElementById('schedule-range');
const dayTimesEl = document.getElementById('day-times');
const dayEventsLayer = document.getElementById('day-events');
const weekTimesEl = document.getElementById('week-times');
const weekColumnsEl = document.getElementById('week-columns');

const viewButtons = document.querySelectorAll('.toggle-button[data-view]');

function initTimeColumns() {
  for (let h = 6; h <= 22; h++) {
    const label = document.createElement('div');
    label.className = 'time-slot-label';
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    label.textContent = formatTime(d);
    dayTimesEl.appendChild(label.cloneNode(true));
    weekTimesEl.appendChild(label);
  }
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function renderRange() {
  scheduleRangeEl.textContent = formatRangeLabel(state.currentDate, state.view);
}

function eventsForDay(dayDate) {
  const start = startOfDay(dayDate);
  const end = addMinutes(start, 24 * 60);
  return state.events.filter((e) => e.start >= start && e.start < end);
}

function suggestionsForDay(dayDate) {
  const start = startOfDay(dayDate);
  const end = addMinutes(start, 24 * 60);
  return state.suggestions.filter((s) => s.start >= start && s.start < end);
}

function posFromDate(date) {
  const minutesFrom6 = date.getHours() * 60 + date.getMinutes() - 6 * 60;
  const clamped = Math.max(0, minutesFrom6);
  const px = (clamped / 60) * 40; // 40px per hour
  return px;
}

function heightFromDuration(start, end) {
  const diffMin = Math.max(30, (end - start) / 60000);
  return (diffMin / 60) * 40;
}

function renderDayView() {
  clearChildren(dayEventsLayer);
  const dayEvents = eventsForDay(state.currentDate);
  const daySuggestions = suggestionsForDay(state.currentDate);

  dayEvents.forEach((event, index) => {
    const div = document.createElement('div');
    div.className = 'day-event';
    const top = posFromDate(event.start);
    const height = heightFromDuration(event.start, event.end);
    div.style.top = `${top}px`;
    div.style.height = `${height}px`;
    div.innerHTML = `<span class="event-title">${event.title}</span><span class="event-time">${formatTime(event.start)} – ${formatTime(event.end)}</span>`;
    div.title = `Event #${index + 1}`;
    dayEventsLayer.appendChild(div);
  });

  daySuggestions.forEach((block) => {
    const div = document.createElement('div');
    div.className = 'suggestion-block';
    const top = posFromDate(block.start);
    const height = heightFromDuration(block.start, block.end);
    div.style.top = `${top}px`;
    div.style.height = `${height}px`;
    div.innerHTML = `<span class="event-title">Suggested</span><span class="event-time">${formatTime(block.start)} – ${formatTime(block.end)}</span>`;
    div.title = block.reason || 'Suggested time slot';
    dayEventsLayer.appendChild(div);
  });
}

function renderWeekView() {
  clearChildren(weekColumnsEl);
  const start = startOfWeek(state.currentDate);

  for (let i = 0; i < 7; i++) {
    const dayDate = addMinutes(start, i * 24 * 60);
    const col = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'week-day-header';
    const name = document.createElement('div');
    name.className = 'week-day-name';
    name.textContent = dayDate.toLocaleDateString(undefined, { weekday: 'short' });
    const dateLabel = document.createElement('div');
    dateLabel.className = 'week-day-date';
    dateLabel.textContent = dayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    header.appendChild(name);
    header.appendChild(dateLabel);

    const body = document.createElement('div');
    body.className = 'week-day-body';

    const events = eventsForDay(dayDate);
    const suggestions = suggestionsForDay(dayDate);

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const div = document.createElement('div');
      div.className = 'week-event';
      const top = posFromDate(event.start);
      const height = heightFromDuration(event.start, event.end);
      div.style.top = `${top}px`;
      div.style.height = `${height}px`;
      div.innerHTML = `<span class="event-title">${event.title}</span><span class="event-time">${formatTime(event.start)}</span>`;
      body.appendChild(div);
    }

    for (let j = 0; j < suggestions.length; j++) {
      const block = suggestions[j];
      const div = document.createElement('div');
      div.className = 'suggestion-block';
      const top = posFromDate(block.start);
      const height = heightFromDuration(block.start, block.end);
      div.style.top = `${top}px`;
      div.style.height = `${height}px`;
      div.innerHTML = `<span class="event-title">Suggested</span><span class="event-time">${formatTime(block.start)}</span>`;
      body.appendChild(div);
    }

    col.appendChild(header);
    col.appendChild(body);
    weekColumnsEl.appendChild(col);
  }
}

function render() {
  renderRange();
  renderDayView();
  renderWeekView();
}

// SECTION: Chat Rendering
function appendMessage(text, from = 'user') {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${from === 'user' ? 'user-message' : 'bot-message'}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = from === 'user' ? '🧑' : '🤖';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;

  if (from === 'user') {
    wrapper.appendChild(bubble);
    wrapper.appendChild(avatar);
  } else {
    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
  }

  chatWindow.appendChild(wrapper);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// SECTION: Command Handling
function handleHelp() {
  appendMessage(
    'You can say things like: "Add lunch with Sam tomorrow at 1pm", "What’s on my schedule today?", "Find 1 hour for deep work this week", or "Move my 3pm event to Friday at 10am".',
    'bot'
  );
}

function handleAdd(input) {
  const { start, end } = parseWhen(input);
  const title = inferTitle(input);
  const event = {
    id: idCounter++,
    title,
    start,
    end,
    sourceText: input,
  };
  state.events.push(event);
  state.suggestions = [];
  state.currentDate = start;
  appendMessage(`Got it. I added “${title}” on ${start.toLocaleDateString()} from ${formatTime(start)} to ${formatTime(end)}.`, 'bot');
  render();
}

function handleView(input) {
  const lower = input.toLowerCase();
  if (lower.includes('week')) {
    state.view = 'week';
  } else {
    state.view = 'day';
  }

  if (/tomorrow/i.test(input)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    state.currentDate = d;
  } else if (/next week/i.test(input)) {
    const d = startOfWeek(new Date());
    d.setDate(d.getDate() + 7);
    state.currentDate = d;
  } else if (/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(input)) {
    const dayName = input.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)[1];
    const target = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(dayName.toLowerCase());
    let d = new Date();
    while (d.getDay() !== target) d.setDate(d.getDate() + 1);
    state.currentDate = d;
  } else {
    state.currentDate = new Date();
  }

  const range = formatRangeLabel(state.currentDate, state.view);
  appendMessage(`Here’s your ${state.view === 'day' ? 'day' : 'week'}: ${range}.`, 'bot');
  render();
}

function handleSuggest(input) {
  const when = parseWhen(input);
  const duration = when.durationMin;
  const baseDay = when.start;
  state.currentDate = baseDay;

  const dayStart = startOfDay(baseDay);
  const dayEnd = addMinutes(dayStart, 24 * 60);

  const dayEvents = eventsForDay(baseDay).sort((a, b) => a.start - b.start);

  const blocks = [];
  let cursor = addMinutes(dayStart, 6 * 60); // start 6am

  for (const ev of dayEvents) {
    if (ev.start > cursor) {
      blocks.push({ start: cloneDate(cursor), end: cloneDate(ev.start) });
    }
    if (ev.end > cursor) cursor = cloneDate(ev.end);
  }

  if (cursor < dayEnd) {
    blocks.push({ start: cloneDate(cursor), end: cloneDate(dayEnd) });
  }

  const suitable = blocks.find((b) => (b.end - b.start) / 60000 >= duration);

  state.suggestions = [];

  if (!suitable) {
    appendMessage("I couldn’t find a free slot of that length on this day.", 'bot');
    render();
    return;
  }

  const suggestedStart = cloneDate(suitable.start);
  const suggestedEnd = addMinutes(suggestedStart, duration);
  state.suggestions.push({
    id: 's-' + idCounter++,
    start: suggestedStart,
    end: suggestedEnd,
    reason: 'Suggested slot for: ' + input,
  });

  appendMessage(
    `I found a slot from ${formatTime(suggestedStart)} to ${formatTime(suggestedEnd)} on ${suggestedStart.toLocaleDateString()}.`,
    'bot'
  );
  render();
}

function handleMove(input) {
  if (state.events.length === 0) {
    appendMessage('You don’t have any events yet for me to move.', 'bot');
    return;
  }

  // naive: move the most recent event
  const event = state.events[state.events.length - 1];
  const { start, end } = parseWhen(input);
  event.start = start;
  event.end = end;
  state.currentDate = start;
  state.suggestions = [];

  appendMessage(
    `Okay, I moved “${event.title}” to ${start.toLocaleDateString()} from ${formatTime(start)} to ${formatTime(end)}.`,
    'bot'
  );
  render();
}

function routeCommand(input) {
  const lower = input.toLowerCase();

  if (lower === 'help') {
    handleHelp();
    return;
  }

  if (/(show|what|view|see).*today|this week|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday/.test(lower)) {
    handleView(input);
    return;
  }

  if (/find|slot|free time|available/i.test(lower)) {
    handleSuggest(input);
    return;
  }

  if (/move|reschedule|shift/i.test(lower)) {
    handleMove(input);
    return;
  }

  if (/add|schedule|create/i.test(lower)) {
    handleAdd(input);
    return;
  }

  // fallback: treat as add
  handleAdd(input);
}

// SECTION: Events
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = chatInput.value.trim();
  if (!value) return;
  appendMessage(value, 'user');
  chatInput.value = '';
  routeCommand(value);
});

quickButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const cmd = btn.getAttribute('data-command');
    if (!cmd) return;
    appendMessage(cmd, 'user');
    routeCommand(cmd);
  });
});

viewButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    state.view = view;
    viewButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    document.getElementById('day-view').classList.toggle('is-hidden', view !== 'day');
    document.getElementById('week-view').classList.toggle('is-hidden', view !== 'week');
    render();
  });
});

// SECTION: Init
initTimeColumns();
render();
