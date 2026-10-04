"use strict";

/* ====== НАСТРОЙКИ (меняйте под себя) ====== */
const CONFIG = {
  name: "BARBER·SHOP",
  tagline: "Мужские стрижки, борода, уход",
  phone: "+79990000000",
  whatsapp: "79990000000",
  telegram: "barber_test",
  instagram: "barber_test",
  address: "г. Москва, ул. Примерная, 1",
  mapUrl: "https://yandex.ru/maps/?text=Москва, ул. Примерная, 1",
  workStart: 10,
  workEnd: 20,
  closedWeekdays: [0], // 0 = воскресенье
  daysAhead: 14,
  services: [
    { id: "cut", title: "Мужская стрижка", price: 1500, min: 60 },
    { id: "beard", title: "Борода и усы", price: 1000, min: 30 },
    { id: "combo", title: "Стрижка + борода", price: 2300, min: 90 },
    { id: "kid", title: "Детская стрижка", price: 1000, min: 45 },
  ],
  masters: ["Любой мастер", "Артём", "Игорь", "Макс"],
};

const REMINDER_OPTIONS = [
  { id: "1d", label: "За 1 день", minutes: 24 * 60 },
  { id: "3h", label: "За 3 часа", minutes: 180 },
  { id: "1h", label: "За 1 час", minutes: 60 },
  { id: "30m", label: "За 30 минут", minutes: 30 },
  { id: "morning", label: "Утром в день записи (09:00)", morning: true },
];

const STORE_KEY = "barber.bookings.v1";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, "0");
const money = (n) => n.toLocaleString("ru-RU") + " ₽";

/* ====== Хранилище ====== */
const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
};
const save = (list) => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* приватный режим */ }
};

/* ====== Время и напоминания ====== */
const apptDate = (b) => new Date(`${b.date}T${b.time}:00`);

function reminderTime(b, id) {
  const opt = REMINDER_OPTIONS.find((o) => o.id === id);
  const start = apptDate(b);
  if (opt.morning) {
    const d = new Date(start);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  return new Date(start.getTime() - opt.minutes * 60000);
}

const reminderLabel = (id) => REMINDER_OPTIONS.find((o) => o.id === id)?.label || id;

/* ====== ICS: календарь (VEVENT) и «Напоминания» (VTODO) ====== */
const icsDate = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const icsEscape = (s) => String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

function buildAlarms(b, title) {
  return b.reminders
    .map((id) => {
      const t = reminderTime(b, id);
      return [
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape(title)}`,
        `TRIGGER;VALUE=DATE-TIME:${icsDate(t)}`,
        "END:VALARM",
      ].join("\r\n");
    })
    .join("\r\n");
}

function buildIcs(b, kind) {
  const svc = CONFIG.services.find((s) => s.id === b.service);
  const start = apptDate(b);
  const end = new Date(start.getTime() + svc.min * 60000);
  const title = `${svc.title} — ${CONFIG.name}`;
  const desc = `Мастер: ${b.master}\nАдрес: ${CONFIG.address}\nТелефон: ${CONFIG.phone}`;
  const alarms = buildAlarms(b, title);
  const body =
    kind === "todo"
      ? [
          "BEGIN:VTODO",
          `UID:${b.id}-todo@barber`,
          `DTSTAMP:${icsDate(new Date())}`,
          `DTSTART:${icsDate(start)}`,
          `DUE:${icsDate(start)}`,
          `SUMMARY:${icsEscape(title)}`,
          `DESCRIPTION:${icsEscape(desc)}`,
          `LOCATION:${icsEscape(CONFIG.address)}`,
          alarms,
          "END:VTODO",
        ]
      : [
          "BEGIN:VEVENT",
          `UID:${b.id}@barber`,
          `DTSTAMP:${icsDate(new Date())}`,
          `DTSTART:${icsDate(start)}`,
          `DTEND:${icsDate(end)}`,
          `SUMMARY:${icsEscape(title)}`,
          `DESCRIPTION:${icsEscape(desc)}`,
          `LOCATION:${icsEscape(CONFIG.address)}`,
          alarms,
          "END:VEVENT",
        ];
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Barber//RU", "CALSCALE:GREGORIAN", ...body.filter(Boolean), "END:VCALENDAR"].join("\r\n");
}

function downloadIcs(b, kind) {
  const blob = new Blob([buildIcs(b, kind)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = kind === "todo" ? "barber-reminder.ics" : "barber-visit.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function googleCalUrl(b) {
  const svc = CONFIG.services.find((s) => s.id === b.service);
  const start = apptDate(b);
  const end = new Date(start.getTime() + svc.min * 60000);
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `${svc.title} — ${CONFIG.name}`,
    dates: `${icsDate(start)}/${icsDate(end)}`,
    details: `Мастер: ${b.master}\nТелефон: ${CONFIG.phone}`,
    location: CONFIG.address,
  });
  return "https://calendar.google.com/calendar/render?" + p;
}

/* ====== Уведомления браузера (работают, пока вкладка открыта) ====== */
const timers = new Map();

function fireReminder(b, id) {
  const svc = CONFIG.services.find((s) => s.id === b.service);
  const when = apptDate(b).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const text = `${svc.title}, ${when}. ${CONFIG.address}`;
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification("Напоминание о записи", { body: text }); } catch { /* ignore */ }
  }
  toast("🔔 " + text);
  const list = load();
  const item = list.find((x) => x.id === b.id);
  if (item) {
    item.fired = [...new Set([...(item.fired || []), id])];
    save(list);
  }
}

function scheduleAll() {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  const now = Date.now();
  load().forEach((b) => {
    if (!b.notify) return;
    b.reminders.forEach((id) => {
      if ((b.fired || []).includes(id)) return;
      const delay = reminderTime(b, id) - now;
      if (apptDate(b) < now) return;
      if (delay <= 0) { fireReminder(b, id); return; }
      if (delay < 2 ** 31 - 1) timers.set(b.id + id, setTimeout(() => fireReminder(b, id), delay));
    });
  });
}

async function askNotifyPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

/* ====== UI ====== */
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 5000);
}

const sheet = $("#sheet");
function openSheet(id) {
  $$(".panel", sheet).forEach((p) => (p.hidden = p.id !== id));
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("lock");
  $(".sheet-body", sheet).scrollTop = 0;
}
function closeSheet() {
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
  document.body.classList.remove("lock");
}
sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.closest("[data-close]")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

/* --- запись --- */
const state = { service: null, master: CONFIG.masters[0], date: null, time: null };

function renderServices() {
  $("#services").innerHTML = CONFIG.services
    .map((s) => `<button type="button" class="chip big" data-svc="${s.id}"><b>${s.title}</b><span>${money(s.price)} · ${s.min} мин</span></button>`)
    .join("");
  $("#masters").innerHTML = CONFIG.masters
    .map((m, i) => `<button type="button" class="chip" data-master="${m}" aria-pressed="${i === 0}">${m}</button>`)
    .join("");
}

function renderDays() {
  const days = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = 0; days.length < CONFIG.daysAhead; i++) {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    if (!CONFIG.closedWeekdays.includes(x.getDay())) days.push(x);
  }
  $("#days").innerHTML = days
    .map((x) => {
      const iso = `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
      const wd = x.toLocaleDateString("ru-RU", { weekday: "short" });
      return `<button type="button" class="day" data-date="${iso}"><small>${wd}</small><b>${x.getDate()}</b></button>`;
    })
    .join("");
}

function busySlots(date) {
  // «занятость» для демо: часть слотов занята детерминированно + реальные записи из localStorage
  const taken = new Set(load().filter((b) => b.date === date && b.master === state.master).map((b) => b.time));
  const seed = [...date].reduce((a, c) => a + c.charCodeAt(0), 0);
  for (let h = CONFIG.workStart; h < CONFIG.workEnd; h++) if ((seed + h * 7) % 5 === 0) taken.add(`${pad(h)}:00`);
  return taken;
}

function renderTimes() {
  const box = $("#times");
  if (!state.date) { box.innerHTML = '<p class="hint">Сначала выберите дату</p>'; return; }
  const busy = busySlots(state.date);
  const now = new Date();
  const out = [];
  for (let h = CONFIG.workStart; h < CONFIG.workEnd; h++) {
    const t = `${pad(h)}:00`;
    const past = new Date(`${state.date}T${t}:00`) < now;
    const dis = busy.has(t) || past;
    out.push(`<button type="button" class="time" data-time="${t}" ${dis ? "disabled" : ""} aria-pressed="${state.time === t}">${t}</button>`);
  }
  box.innerHTML = out.join("");
}

function renderReminderChoices(container, selected) {
  container.innerHTML = REMINDER_OPTIONS.map(
    (o) => `<label class="check"><input type="checkbox" value="${o.id}" ${selected.includes(o.id) ? "checked" : ""}><span>${o.label}</span></label>`
  ).join("");
}

function updateSummary() {
  const svc = CONFIG.services.find((s) => s.id === state.service);
  $("#summary").textContent =
    svc && state.date && state.time
      ? `${svc.title} · ${state.master} · ${new Date(state.date).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} в ${state.time} · ${money(svc.price)}`
      : "Выберите услугу, дату и время";
}

function markSelected() {
  $$("[data-svc]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.svc === state.service));
  $$("[data-master]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.master === state.master));
  $$("[data-date]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.date === state.date));
}

$("#booking").addEventListener("click", (e) => {
  const svc = e.target.closest("[data-svc]");
  const master = e.target.closest("[data-master]");
  const day = e.target.closest("[data-date]");
  const time = e.target.closest("[data-time]");
  if (svc) state.service = svc.dataset.svc;
  if (master) { state.master = master.dataset.master; state.time = null; }
  if (day) { state.date = day.dataset.date; state.time = null; }
  if (time) state.time = time.dataset.time;
  if (svc || master || day || time) { markSelected(); renderTimes(); updateSummary(); }
});

$("#booking").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#name").value.trim();
  const phone = $("#phone").value.trim();
  if (!state.service || !state.date || !state.time) return toast("Выберите услугу, дату и время");
  if (name.length < 2) return toast("Укажите имя");
  if (phone.replace(/\D/g, "").length < 10) return toast("Проверьте номер телефона");

  const reminders = $$("#remindChoices input:checked").map((i) => i.value);
  const notify = $("#notifyToggle").checked;
  const b = {
    id: "b" + Date.now().toString(36),
    ...state, name, phone, reminders, notify, fired: [],
  };
  if (notify && reminders.length) {
    const ok = await askNotifyPermission();
    if (!ok) { b.notify = false; toast("Уведомления в браузере запрещены — используйте календарь"); }
  }
  const list = load();
  list.push(b);
  save(list);
  scheduleAll();
  showDone(b);
  renderMy();
});

function showDone(b) {
  const svc = CONFIG.services.find((s) => s.id === b.service);
  $("#doneInfo").textContent = `${svc.title} · ${b.master} · ${new Date(b.date).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} в ${b.time}`;
  $("#doneInfo").dataset.id = b.id;
  renderReminderChoices($("#doneRemind"), b.reminders);
  $("#doneNotify").checked = b.notify;
  $("#gcal").href = googleCalUrl(b);
  openSheet("p-done");
}

function currentDone() {
  return load().find((x) => x.id === $("#doneInfo").dataset.id);
}

// смена набора напоминаний уже после записи
$("#p-done").addEventListener("change", async (e) => {
  const list = load();
  const b = list.find((x) => x.id === $("#doneInfo").dataset.id);
  if (!b) return;
  if (e.target.closest("#doneRemind")) b.reminders = $$("#doneRemind input:checked").map((i) => i.value);
  if (e.target.id === "doneNotify") {
    b.notify = e.target.checked;
    if (b.notify && !(await askNotifyPermission())) { b.notify = false; e.target.checked = false; toast("Разрешите уведомления в настройках браузера"); }
  }
  b.fired = [];
  save(list);
  scheduleAll();
  $("#gcal").href = googleCalUrl(b);
  renderMy();
});

$("#p-done").addEventListener("click", (e) => {
  const b = currentDone();
  if (!b) return;
  if (e.target.closest("#dlCal")) downloadIcs(b, "event");
  if (e.target.closest("#dlTodo")) downloadIcs(b, "todo");
});

/* --- мои записи --- */
function renderMy() {
  const list = load().filter((b) => apptDate(b) > new Date()).sort((a, b) => apptDate(a) - apptDate(b));
  $("#myCount").textContent = list.length ? String(list.length) : "";
  $("#myList").innerHTML = list.length
    ? list
        .map((b) => {
          const svc = CONFIG.services.find((s) => s.id === b.service);
          const when = apptDate(b).toLocaleString("ru-RU", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
          const rem = b.reminders.length ? b.reminders.map(reminderLabel).join(", ") : "без напоминаний";
          return `<li class="card"><b>${svc.title}</b><span>${when} · ${b.master}</span><small>🔔 ${rem}</small>
            <div class="row"><button class="btn ghost" data-edit="${b.id}">Напоминания</button><button class="btn ghost danger" data-cancel="${b.id}">Отменить</button></div></li>`;
        })
        .join("")
    : '<li class="hint">Пока нет предстоящих записей</li>';
}

$("#myList").addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  const cancel = e.target.closest("[data-cancel]");
  if (edit) { const b = load().find((x) => x.id === edit.dataset.edit); if (b) showDone(b); }
  if (cancel && confirm("Отменить запись?")) {
    save(load().filter((x) => x.id !== cancel.dataset.cancel));
    scheduleAll();
    renderMy();
    toast("Запись отменена");
  }
});

/* --- ссылки и кнопки --- */
function initLinks() {
  $("#brand").textContent = CONFIG.name;
  $("#tagline").textContent = CONFIG.tagline;
  $("#lnkCall").href = "tel:" + CONFIG.phone;
  $("#lnkWa").href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Здравствуйте! Хочу записаться на стрижку")}`;
  $("#lnkTg").href = "https://t.me/" + CONFIG.telegram;
  $("#lnkIg").href = "https://instagram.com/" + CONFIG.instagram;
  $("#lnkMap").href = CONFIG.mapUrl;
  $("#addr").textContent = CONFIG.address;
  $("#prices").innerHTML = CONFIG.services.map((s) => `<li><span>${s.title}</span><b>${money(s.price)}</b></li>`).join("");
}

document.addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  if (open) { e.preventDefault(); openSheet(open.dataset.open); }
});

/* --- init --- */
initLinks();
renderServices();
renderDays();
renderTimes();
renderReminderChoices($("#remindChoices"), ["1d", "1h"]);
updateSummary();
renderMy();
scheduleAll();
