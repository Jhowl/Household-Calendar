const fs = require('fs')
const path = require('path')
const express = require('express')
const cors = require('cors')
const Database = require('better-sqlite3')
require('dotenv').config()

const app = express()
const PORT = process.env.PORT || 4000
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'home-organizer.db')
const TELEGRAM_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    notes TEXT,
    assignee_id INTEGER,
    color TEXT,
    category TEXT,
    priority TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (assignee_id) REFERENCES people(id)
  );
  CREATE TABLE IF NOT EXISTS recurrence_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    freq TEXT NOT NULL,
    interval INTEGER NOT NULL DEFAULT 1,
    by_weekday TEXT,
    by_monthday TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    timezone TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );
  CREATE TABLE IF NOT EXISTS instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    completed_at TEXT,
    notes TEXT,
    UNIQUE(task_id, date),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );
`)

const ensureColumn = (table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  const exists = columns.some((item) => item.name === column)
  if (!exists) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run()
  }
}

ensureColumn('tasks', 'color', 'TEXT')

app.use(cors())
app.use(express.json({ limit: '1mb' }))

const weekdayMap = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

const toIsoDate = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseIsoDate = (value) => {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const getMonthRange = (year, month) => {
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0)
  return { start, end }
}

const diffInDays = (a, b) => {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.floor((utcA - utcB) / (1000 * 60 * 60 * 24))
}

const diffInMonths = (a, b) => {
  return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth())
}

const normalizeWeekdays = (value, fallbackDay) => {
  if (!value) return [fallbackDay]
  const parts = value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  const weekdays = parts.map((day) => weekdayMap[day]).filter((day) => day !== undefined)
  return weekdays.length ? weekdays : [fallbackDay]
}

const normalizeMonthdays = (value, fallbackDay) => {
  if (!value) return [fallbackDay]
  const parts = value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item))
  return parts.length ? parts : [fallbackDay]
}

const generateOccurrencesForRule = (rule, task, monthStart, monthEnd, instanceMap, assigneeMap) => {
  const occurrences = []
  const startDate = parseIsoDate(rule.start_date)
  if (!startDate) return occurrences
  const endDate = rule.end_date ? parseIsoDate(rule.end_date) : null
  const { freq, interval } = rule
  const intervalValue = Math.max(1, Number(interval || 1))

  const startDay = startDate.getDay()
  const weekdays = normalizeWeekdays(rule.by_weekday, startDay)
  const monthdays = normalizeMonthdays(rule.by_monthday, startDate.getDate())

  for (let day = new Date(monthStart); day <= monthEnd; day.setDate(day.getDate() + 1)) {
    if (day < startDate) continue
    if (endDate && day > endDate) continue

    let matches = false
    if (freq === 'once') {
      matches = toIsoDate(day) === rule.start_date
    } else if (freq === 'daily') {
      const daysDiff = diffInDays(day, startDate)
      matches = daysDiff % intervalValue === 0
    } else if (freq === 'weekly') {
      const weeksDiff = Math.floor(diffInDays(day, startDate) / 7)
      matches = weeksDiff % intervalValue === 0 && weekdays.includes(day.getDay())
    } else if (freq === 'monthly') {
      const monthsDiff = diffInMonths(day, startDate)
      matches = monthsDiff % intervalValue === 0 && monthdays.includes(day.getDate())
    }

    if (!matches) continue
    const dateKey = toIsoDate(day)
    const instance = instanceMap.get(`${task.id}-${dateKey}`)
    const assignee = task.assignee_id ? assigneeMap.get(task.assignee_id) : null
    occurrences.push({
      date: dateKey,
      taskId: task.id,
      title: task.title,
      notes: task.notes,
      color: task.color,
      category: task.category,
      priority: task.priority,
      status: instance?.status || 'open',
      assigneeId: task.assignee_id,
      assigneeName: assignee?.name || null,
      assigneeColor: assignee?.color || null,
    })
  }

  return occurrences
}

const fetchMonthData = (year, month) => {
  const { start, end } = getMonthRange(year, month)
  const monthStart = toIsoDate(start)
  const monthEnd = toIsoDate(end)

  const people = db.prepare('SELECT * FROM people WHERE active = 1').all()
  const assigneeMap = new Map(people.map((person) => [person.id, person]))

  const tasks = db.prepare(`
    SELECT
      tasks.id AS task_id,
      tasks.title AS task_title,
      tasks.notes AS task_notes,
      tasks.assignee_id AS task_assignee_id,
      tasks.category AS task_category,
      tasks.priority AS task_priority,
      tasks.color AS task_color,
      recurrence_rules.id AS rule_id,
      recurrence_rules.freq AS rule_freq,
      recurrence_rules.interval AS rule_interval,
      recurrence_rules.by_weekday AS rule_by_weekday,
      recurrence_rules.by_monthday AS rule_by_monthday,
      recurrence_rules.start_date AS rule_start_date,
      recurrence_rules.end_date AS rule_end_date,
      recurrence_rules.timezone AS rule_timezone
    FROM tasks
    JOIN recurrence_rules ON recurrence_rules.task_id = tasks.id
    WHERE tasks.active = 1
  `).all()

  const instances = db.prepare('SELECT * FROM instances WHERE date BETWEEN ? AND ?').all(monthStart, monthEnd)
  const instanceMap = new Map(instances.map((instance) => [`${instance.task_id}-${instance.date}`, instance]))

  const occurrences = tasks.flatMap((item) => {
    const task = {
      id: item.task_id,
      title: item.task_title,
      notes: item.task_notes,
      assignee_id: item.task_assignee_id,
      color: item.task_color,
      category: item.task_category,
      priority: item.task_priority,
    }
    const rule = {
      id: item.rule_id,
      freq: item.rule_freq,
      interval: item.rule_interval,
      by_weekday: item.rule_by_weekday,
      by_monthday: item.rule_by_monthday,
      start_date: item.rule_start_date,
      end_date: item.rule_end_date,
      timezone: item.rule_timezone,
    }
    return generateOccurrencesForRule(rule, task, start, end, instanceMap, assigneeMap)
  })

  return {
    month: { year, month },
    range: { start: monthStart, end: monthEnd },
    people,
    occurrences,
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.get('/api/month', (req, res) => {
  const now = new Date()
  const year = Number(req.query.year) || now.getFullYear()
  const month = Number(req.query.month) || now.getMonth() + 1
  res.json(fetchMonthData(year, month))
})

app.get('/api/people', (req, res) => {
  const people = db.prepare('SELECT * FROM people WHERE active = 1').all()
  res.json({ people })
})

app.post('/api/people', (req, res) => {
  const { name, color } = req.body || {}
  if (!name || !color) {
    return res.status(400).json({ error: 'name and color are required' })
  }
  const stmt = db.prepare('INSERT INTO people (name, color, active) VALUES (?, ?, 1)')
  const result = stmt.run(name.trim(), color.trim())
  res.status(201).json({ id: result.lastInsertRowid })
})

app.patch('/api/people/:id', (req, res) => {
  const id = Number(req.params.id)
  const { name, color, active } = req.body || {}
  const existing = db.prepare('SELECT * FROM people WHERE id = ?').get(id)
  if (!existing) {
    return res.status(404).json({ error: 'Person not found' })
  }
  db.prepare(
    'UPDATE people SET name = ?, color = ?, active = ? WHERE id = ?'
  ).run(name ?? existing.name, color ?? existing.color, active ?? existing.active, id)
  res.json({ ok: true })
})

app.delete('/api/people/:id', (req, res) => {
  const id = Number(req.params.id)
  db.prepare('UPDATE people SET active = 0 WHERE id = ?').run(id)
  res.json({ ok: true })
})

app.post('/api/tasks', (req, res) => {
  const { title, notes, assigneeId, category, priority, color, recurrence } = req.body || {}
  if (!title || !recurrence?.freq) {
    return res.status(400).json({ error: 'title and recurrence are required' })
  }
  const createdAt = toIsoDate(new Date())
  const taskStmt = db.prepare(`
    INSERT INTO tasks (title, notes, assignee_id, color, category, priority, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `)
  const taskResult = taskStmt.run(
    title.trim(),
    notes || null,
    assigneeId || null,
    color || null,
    category || null,
    priority || null,
    createdAt
  )

  const ruleStmt = db.prepare(`
    INSERT INTO recurrence_rules (task_id, freq, interval, by_weekday, by_monthday, start_date, end_date, timezone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  ruleStmt.run(
    taskResult.lastInsertRowid,
    recurrence.freq,
    recurrence.interval || 1,
    recurrence.byWeekday || null,
    recurrence.byMonthday || null,
    recurrence.startDate || createdAt,
    recurrence.endDate || null,
    recurrence.timezone || null
  )

  res.status(201).json({ id: taskResult.lastInsertRowid })
})

app.get('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id)
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  if (!task) {
    return res.status(404).json({ error: 'Task not found' })
  }
  const rule = db.prepare('SELECT * FROM recurrence_rules WHERE task_id = ?').get(id)
  res.json({ task, rule })
})

app.patch('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id)
  const { title, notes, assigneeId, category, priority, color, active, recurrence } = req.body || {}
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  if (!task) {
    return res.status(404).json({ error: 'Task not found' })
  }
  db.prepare(
    'UPDATE tasks SET title = ?, notes = ?, assignee_id = ?, color = ?, category = ?, priority = ?, active = ? WHERE id = ?'
  ).run(
    title ?? task.title,
    notes ?? task.notes,
    assigneeId ?? task.assignee_id,
    color ?? task.color,
    category ?? task.category,
    priority ?? task.priority,
    active ?? task.active,
    id
  )

  if (recurrence) {
    const existingRule = db.prepare('SELECT * FROM recurrence_rules WHERE task_id = ?').get(id)
    if (existingRule) {
      db.prepare(`
        UPDATE recurrence_rules
        SET freq = ?, interval = ?, by_weekday = ?, by_monthday = ?, start_date = ?, end_date = ?, timezone = ?
        WHERE task_id = ?
      `).run(
        recurrence.freq ?? existingRule.freq,
        recurrence.interval ?? existingRule.interval,
        recurrence.byWeekday ?? existingRule.by_weekday,
        recurrence.byMonthday ?? existingRule.by_monthday,
        recurrence.startDate ?? existingRule.start_date,
        recurrence.endDate ?? existingRule.end_date,
        recurrence.timezone ?? existingRule.timezone,
        id
      )
    }
  }

  res.json({ ok: true })
})

app.delete('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id)
  db.prepare('UPDATE tasks SET active = 0 WHERE id = ?').run(id)
  res.json({ ok: true })
})

app.post('/api/tasks/:id/stop', (req, res) => {
  const id = Number(req.params.id)
  const { date } = req.body || {}
  if (!date) {
    return res.status(400).json({ error: 'date is required' })
  }
  const stopDate = parseIsoDate(date)
  if (!stopDate) {
    return res.status(400).json({ error: 'invalid date' })
  }
  stopDate.setDate(stopDate.getDate() - 1)
  const endDate = toIsoDate(stopDate)
  const rule = db.prepare('SELECT * FROM recurrence_rules WHERE task_id = ?').get(id)
  if (!rule) {
    return res.status(404).json({ error: 'Rule not found' })
  }
  if (rule.end_date && rule.end_date < endDate) {
    return res.json({ ok: true })
  }
  db.prepare('UPDATE recurrence_rules SET end_date = ? WHERE task_id = ?').run(endDate, id)
  res.json({ ok: true })
})

app.post('/api/instances', (req, res) => {
  const { taskId, date, status, notes } = req.body || {}
  if (!taskId || !date) {
    return res.status(400).json({ error: 'taskId and date are required' })
  }
  const existing = db.prepare('SELECT * FROM instances WHERE task_id = ? AND date = ?').get(taskId, date)
  const now = new Date()
  const completedAt = status === 'done' ? now.toISOString() : null

  if (existing) {
    db.prepare(
      'UPDATE instances SET status = ?, completed_at = ?, notes = ? WHERE task_id = ? AND date = ?'
    ).run(status || existing.status, completedAt, notes ?? existing.notes, taskId, date)
  } else {
    db.prepare(
      'INSERT INTO instances (task_id, date, status, completed_at, notes) VALUES (?, ?, ?, ?, ?)'
    ).run(taskId, date, status || 'open', completedAt, notes || null)
  }
  res.json({ ok: true })
})

const parseTelegramText = (text) => {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed.toLowerCase().startsWith('/chore')) return null
  const body = trimmed.replace(/^\/chore\s*/i, '')
  if (!body) return null

  const assigneeMatch = body.match(/assignee=([^\s]+)/i)
  const assignee = assigneeMatch ? assigneeMatch[1].replace(/_/g, ' ') : null

  const dayMatch = body.match(/day=(\d{1,2})/i)
  const monthday = dayMatch ? dayMatch[1] : null

  const weekdayMatches = body.match(/\b(mon|tue|wed|thu|fri|sat|sun)\b/gi)
  const byWeekday = weekdayMatches ? weekdayMatches.map((item) => item.toLowerCase()).join(',') : null

  let freq = null
  let interval = 1
  const everyMatch = body.match(/every\s+(\d+)\s+(day|week|month)s?/i)
  if (everyMatch) {
    interval = Number(everyMatch[1])
    const unit = everyMatch[2].toLowerCase()
    freq = unit === 'day' ? 'daily' : unit === 'week' ? 'weekly' : 'monthly'
  } else if (/\bdaily\b/i.test(body)) {
    freq = 'daily'
  } else if (/\bweekly\b/i.test(body)) {
    freq = 'weekly'
  } else if (/\bmonthly\b/i.test(body)) {
    freq = 'monthly'
  }

  const title = body
    .replace(/assignee=[^\s]+/i, '')
    .replace(/day=\d{1,2}/i, '')
    .replace(/every\s+\d+\s+(day|week|month)s?/i, '')
    .replace(/\b(daily|weekly|monthly)\b/gi, '')
    .trim()

  return {
    title: title || body,
    assignee,
    freq,
    interval,
    byWeekday,
    byMonthday: monthday,
  }
}

app.post('/api/telegram/webhook', (req, res) => {
  if (TELEGRAM_SECRET) {
    const header = req.get('x-telegram-bot-api-secret-token') || ''
    if (header !== TELEGRAM_SECRET) {
      return res.status(401).json({ error: 'invalid secret token' })
    }
  }

  const message = req.body?.message?.text
  const parsed = parseTelegramText(message)
  if (!parsed) {
    return res.json({ ok: true, ignored: true })
  }

  const now = toIsoDate(new Date())
  const freq = parsed.freq || 'weekly'
  const rule = {
    freq,
    interval: parsed.interval || 1,
    byWeekday: parsed.byWeekday,
    byMonthday: parsed.byMonthday,
    startDate: now,
    endDate: null,
  }

  let assigneeId = null
  if (parsed.assignee) {
    const person = db.prepare('SELECT * FROM people WHERE name = ? AND active = 1').get(parsed.assignee)
    if (person) assigneeId = person.id
  }

  const taskStmt = db.prepare(`
    INSERT INTO tasks (title, notes, assignee_id, category, priority, active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `)
  const result = taskStmt.run(parsed.title, message || null, assigneeId, null, null, now)

  db.prepare(`
    INSERT INTO recurrence_rules (task_id, freq, interval, by_weekday, by_monthday, start_date, end_date, timezone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(result.lastInsertRowid, rule.freq, rule.interval, rule.byWeekday, rule.byMonthday, rule.startDate, rule.endDate, null)

  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`Home Organizer API running on ${PORT}`)
})
