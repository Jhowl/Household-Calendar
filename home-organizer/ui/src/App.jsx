import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

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

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1)

const addMonths = (date, amount) => new Date(date.getFullYear(), date.getMonth() + amount, 1)

const startOfWeek = (date) => {
  const copy = new Date(date)
  const day = copy.getDay()
  const diff = (day + 6) % 7
  copy.setDate(copy.getDate() - diff)
  return new Date(copy.getFullYear(), copy.getMonth(), copy.getDate())
}

const addDays = (date, amount) => {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + amount)
  return copy
}

const formatWeekLabel = (start) => {
  const end = addDays(start, 6)
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${startLabel} - ${endLabel}`
}

const buildCalendarDays = (monthDate) => {
  const firstDay = startOfMonth(monthDate)
  const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)
  const startWeekday = firstDay.getDay()
  const totalDays = lastDay.getDate()

  const days = []
  for (let i = 0; i < startWeekday; i += 1) {
    days.push(null)
  }
  for (let day = 1; day <= totalDays; day += 1) {
    days.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), day))
  }
  return days
}

const formatMonthLabel = (date) =>
  date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const createDefaultForm = () => {
  const today = new Date()
    return {
      title: '',
      notes: '',
      assigneeId: '',
      category: '',
      priority: 'medium',
      color: '#F7C087',
      freq: 'weekly',
      interval: 1,
      weekdays: [today.getDay()],
      monthday: today.getDate(),
      startDate: toIsoDate(today),
    }
  }

function App() {
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()))
  const [monthData, setMonthData] = useState({ occurrences: [], people: [] })
  const [nextMonthOccurrences, setNextMonthOccurrences] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(createDefaultForm())
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState(createDefaultForm())
  const [editingTask, setEditingTask] = useState(null)
  const [editingDate, setEditingDate] = useState(null)
  const [editingStatus, setEditingStatus] = useState('open')
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [actionItem, setActionItem] = useState(null)
  const [personForm, setPersonForm] = useState({ name: '', color: '#F6C56B' })
  const [menuWeekStart, setMenuWeekStart] = useState(startOfWeek(new Date()))
  const [menuItems, setMenuItems] = useState(() => {
    const raw = window.localStorage.getItem('menuWeekItems')
    return raw ? JSON.parse(raw) : {}
  })
  const [menuNote, setMenuNote] = useState(() => {
    return window.localStorage.getItem('menuWeekNote') || ''
  })

  const refreshMonths = async () => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth() + 1
    const nextMonth = addMonths(currentMonth, 1)
    const nextYearValue = nextMonth.getFullYear()
    const nextMonthValue = nextMonth.getMonth() + 1

    const [response, nextResponse] = await Promise.all([
      fetch(`${API_BASE}/api/month?year=${year}&month=${month}`),
      fetch(`${API_BASE}/api/month?year=${nextYearValue}&month=${nextMonthValue}`),
    ])
    const [data, nextData] = await Promise.all([response.json(), nextResponse.json()])
    setMonthData(data)
    setNextMonthOccurrences(nextData.occurrences || [])
  }

  useEffect(() => {
    const fetchMonth = async () => {
      setIsLoading(true)
      await refreshMonths()
      setIsLoading(false)
    }
    fetchMonth().catch(() => setIsLoading(false))
  }, [currentMonth])

  const calendarDays = useMemo(() => buildCalendarDays(currentMonth), [currentMonth])

  const menuDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => addDays(menuWeekStart, index))
  }, [menuWeekStart])

  const occurrencesByDate = useMemo(() => {
    const priorityRank = { high: 3, medium: 2, low: 1 }
    const map = new Map()
    monthData.occurrences.forEach((item) => {
      if (!map.has(item.date)) map.set(item.date, [])
      map.get(item.date).push(item)
    })
    map.forEach((items) => {
      items.sort((a, b) => (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0))
    })
    return map
  }, [monthData])

  useEffect(() => {
    window.localStorage.setItem('menuWeekItems', JSON.stringify(menuItems))
  }, [menuItems])

  useEffect(() => {
    window.localStorage.setItem('menuWeekNote', menuNote)
  }, [menuNote])

  const upcoming = useMemo(() => {
    const today = new Date()
    const end = new Date()
    end.setDate(today.getDate() + 30)
    return [...monthData.occurrences, ...nextMonthOccurrences]
      .filter((item) => {
        const date = parseIsoDate(item.date)
        return date >= today && date <= end
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [monthData, nextMonthOccurrences])

  const openEditModal = async (item) => {
    const response = await fetch(`${API_BASE}/api/tasks/${item.taskId}`)
    const data = await response.json()
    if (!data.task) return

    const rule = data.rule || {}
    const baseDate = parseIsoDate(rule.start_date || item.date)
    const weekdays = rule.by_weekday
      ? rule.by_weekday
          .split(',')
          .map((day) => day.trim())
          .map((day) => WEEKDAY_KEYS.indexOf(day))
          .filter((value) => value >= 0)
      : [baseDate.getDay()]

    setEditForm({
      title: data.task.title || '',
      notes: data.task.notes || '',
      assigneeId: data.task.assignee_id ? String(data.task.assignee_id) : '',
      category: data.task.category || '',
      priority: data.task.priority || 'medium',
      color: data.task.color || '#F7C087',
      freq: rule.freq || 'weekly',
      interval: rule.interval || 1,
      weekdays: weekdays.length ? weekdays : [baseDate.getDay()],
      monthday: rule.by_monthday ? Number(rule.by_monthday.split(',')[0]) : baseDate.getDate(),
      startDate: rule.start_date || item.date,
    })
    setEditingTask(data.task)
    setEditingDate(item.date)
    setEditingStatus(item.status || 'open')
    setEditOpen(true)
  }

  const handleStopFromDate = async () => {
    if (!editingTask || !editingDate) return
    const confirmed = window.confirm('Stop this chore from the selected day forward?')
    if (!confirmed) return
    await fetch(`${API_BASE}/api/tasks/${editingTask.id}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: editingDate }),
    })
    setEditOpen(false)
    await refreshMonths()
  }

  const handleToggleStatus = async (item) => {
    const nextStatus = item.status === 'done' ? 'open' : 'done'
    await fetch(`${API_BASE}/api/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: item.taskId, date: item.date, status: nextStatus }),
    })
    await refreshMonths()
  }

  const handleOpenActions = (item) => {
    setActionItem(item)
  }

  const handleDeletePerson = async (personId, name) => {
    const confirmed = window.confirm(`Remove ${name} from the household?`)
    if (!confirmed) return
    await fetch(`${API_BASE}/api/people/${personId}`, { method: 'DELETE' })
    await refreshMonths()
  }

  const handleCreateTask = async (event) => {
    event.preventDefault()
    if (!form.title.trim()) return

    const payload = {
      title: form.title.trim(),
      notes: form.notes || null,
      assigneeId: form.assigneeId ? Number(form.assigneeId) : null,
      category: form.category || null,
      priority: form.priority || 'medium',
      color: form.color || null,
      recurrence: {
        freq: form.freq,
        interval: Number(form.interval) || 1,
        byWeekday: form.freq === 'weekly'
          ? form.weekdays.map((day) => WEEKDAY_KEYS[day]).join(',')
          : null,
        byMonthday: form.freq === 'monthly' ? String(form.monthday) : null,
        startDate: form.startDate,
      },
    }

    await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setForm(createDefaultForm())
    setFormOpen(false)
    await refreshMonths()
  }

  const handleAddPerson = async (event) => {
    event.preventDefault()
    if (!personForm.name.trim()) return
    await fetch(`${API_BASE}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: personForm.name.trim(), color: personForm.color }),
    })
    setPersonForm({ name: '', color: '#F6C56B' })
    await refreshMonths()
  }

  const handleUpdateTask = async (event) => {
    event.preventDefault()
    if (!editingTask) return

    const payload = {
      title: editForm.title.trim(),
      notes: editForm.notes || null,
      assigneeId: editForm.assigneeId ? Number(editForm.assigneeId) : null,
      category: editForm.category || null,
      priority: editForm.priority || 'medium',
      color: editForm.color || null,
      recurrence: {
        freq: editForm.freq,
        interval: Number(editForm.interval) || 1,
        byWeekday: editForm.freq === 'weekly'
          ? editForm.weekdays.map((day) => WEEKDAY_KEYS[day]).join(',')
          : null,
        byMonthday: editForm.freq === 'monthly' ? String(editForm.monthday) : null,
        startDate: editForm.startDate,
      },
    }

    await fetch(`${API_BASE}/api/tasks/${editingTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (editingDate) {
      await fetch(`${API_BASE}/api/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: editingTask.id, date: editingDate, status: editingStatus }),
      })
    }

    setEditOpen(false)
    await refreshMonths()
  }

  const handleMenuChange = (date, key, value) => {
    setMenuItems((prev) => {
      const next = { ...prev }
      const existing = next[date] || { breakfast: '', lunch: '', dinner: '' }
      next[date] = { ...existing, [key]: value }
      return next
    })
  }

  const handleDeleteTask = async () => {
    if (!editingTask) return
    const confirmed = window.confirm(`Delete chore "${editingTask.title}" entirely?`)
    if (!confirmed) return
    await fetch(`${API_BASE}/api/tasks/${editingTask.id}`, { method: 'DELETE' })
    setEditOpen(false)
    await refreshMonths()
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-title">
          <p className="eyebrow">Home Organizer</p>
          <h1>Household Calendar</h1>
          <p className="subtitle">All chores, payments, and reminders in one view.</p>
        </div>
        <div className="header-actions">
          <button className="ghost" onClick={() => setCurrentMonth(startOfMonth(new Date()))}>
            Today
          </button>
          <div className="month-nav">
            <button className="ghost" onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}>
              Prev
            </button>
            <span>{formatMonthLabel(currentMonth)}</span>
            <button className="ghost" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
              Next
            </button>
          </div>
          <button className="ghost" onClick={() => setPeopleOpen(true)}>
            Members
          </button>
          <button className="primary" onClick={() => setFormOpen(true)}>
            New chore
          </button>
        </div>
      </header>

      <main className="dashboard">
        <div className="main-column">
          <section className="calendar">
            <div className="weekday-row">
              {WEEKDAYS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="calendar-grid">
              {calendarDays.map((day, index) => {
                if (!day) {
                  return <div key={`empty-${index}`} className="day empty" />
                }
                const iso = toIsoDate(day)
                const items = occurrencesByDate.get(iso) || []
                return (
                  <div key={iso} className="day">
                    <div className="day-header">
                      <span>{day.getDate()}</span>
                      {items.length > 0 && <em>{items.length}</em>}
                    </div>
                    <div className="day-items">
                      {items.slice(0, 4).map((item) => (
                        <button
                          key={`${item.taskId}-${item.date}`}
                        className={`chip ${item.status === 'done' ? 'done' : ''}`}
                        style={{ '--chip': item.color || item.assigneeColor || '#F7C087' }}
                        onClick={() => handleOpenActions(item)}
                        type="button"
                      >
                          <span className="chip-title">
                            {item.assigneeColor && (
                              <span className="marker" style={{ '--marker': item.assigneeColor }} />
                            )}
                            {item.title}
                          </span>
                        </button>
                      ))}
                      {items.length > 4 && (
                        <div className="chip more">+{items.length - 4} more</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {isLoading && <div className="loading">Loading month…</div>}
          </section>

          <section className="menu-planner">
            <div className="menu-header">
              <div>
                <p className="eyebrow">Cooking Plan</p>
                <h2>Weekly Menu + Diet</h2>
                <p className="subtitle">Self organize your meals for the week.</p>
              </div>
              <div className="menu-actions">
                <button className="ghost" onClick={() => setMenuWeekStart(startOfWeek(new Date()))}>
                  This week
                </button>
                <div className="month-nav">
                  <button className="ghost" onClick={() => setMenuWeekStart(addDays(menuWeekStart, -7))}>
                    Prev
                  </button>
                  <span>{formatWeekLabel(menuWeekStart)}</span>
                  <button className="ghost" onClick={() => setMenuWeekStart(addDays(menuWeekStart, 7))}>
                    Next
                  </button>
                </div>
              </div>
            </div>
            <div className="menu-grid">
              <div className="menu-row header">
                <span />
                {menuDays.map((day) => (
                  <span key={toIsoDate(day)}>
                    {day.toLocaleDateString('en-US', { weekday: 'short' })}
                    <em>{day.getDate()}</em>
                  </span>
                ))}
              </div>
              {['breakfast', 'lunch', 'dinner'].map((meal) => (
                <div key={meal} className="menu-row">
                  <span className="meal-label">{meal}</span>
                  {menuDays.map((day) => {
                    const iso = toIsoDate(day)
                    const value = menuItems[iso]?.[meal] || ''
                    return (
                      <input
                        key={`${iso}-${meal}`}
                        type="text"
                        placeholder="Add item"
                        value={value}
                        onChange={(event) => handleMenuChange(iso, meal, event.target.value)}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
            <label className="menu-note">
              Weekly focus
              <textarea
                rows={3}
                value={menuNote}
                onChange={(event) => setMenuNote(event.target.value)}
                placeholder="Nutrition goals, prep notes, or grocery reminders"
              />
            </label>
          </section>
        </div>

        <aside className="side-panel">
          <div className="panel-card">
            <h2>Next 30 days</h2>
            <div className="upcoming-list">
              {upcoming.length === 0 && <p className="muted">No chores scheduled yet.</p>}
              {upcoming.map((item) => (
                <button
                  key={`${item.taskId}-${item.date}`}
                  className="upcoming-item"
                  type="button"
                  onClick={() => handleOpenActions(item)}
                >
                  <div>
                    <strong className="chip-title">
                      {item.assigneeColor && (
                        <span className="marker" style={{ '--marker': item.assigneeColor }} />
                      )}
                      {item.title}
                    </strong>
                    <span>
                      {parseIsoDate(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  {item.assigneeName && (
                    <span className="pill" style={{ '--pill': item.assigneeColor || '#F7C087' }}>
                      {item.assigneeName}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

        </aside>
      </main>

      {formOpen && (
        <div className="modal-backdrop" onClick={() => setFormOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>New chore</h2>
              <button className="ghost" onClick={() => setFormOpen(false)} type="button">Close</button>
            </div>
            <form className="task-form" onSubmit={handleCreateTask}>
              <label>
                Title
                <input
                  type="text"
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  required
                />
              </label>
              <label>
                Notes
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  rows={3}
                />
              </label>
              <div className="form-row">
                <label>
                  Assignee
                  <select
                    value={form.assigneeId}
                    onChange={(event) => setForm({ ...form, assigneeId: event.target.value })}
                  >
                    <option value="">Anyone</option>
                    {monthData.people?.map((person) => (
                      <option key={person.id} value={person.id}>{person.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={form.priority}
                    onChange={(event) => setForm({ ...form, priority: event.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>
                  Task color
                  <input
                    type="color"
                    value={form.color}
                    onChange={(event) => setForm({ ...form, color: event.target.value })}
                    aria-label="Pick task color"
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Frequency
                  <select
                    value={form.freq}
                    onChange={(event) => setForm({ ...form, freq: event.target.value })}
                  >
                    <option value="once">One-time</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                {form.freq !== 'once' && (
                  <label>
                    Interval
                    <input
                      type="number"
                      min="1"
                      value={form.interval}
                      onChange={(event) => setForm({ ...form, interval: event.target.value })}
                    />
                  </label>
                )}
              </div>
              {form.freq === 'weekly' && (
                <div className="weekday-picker">
                  {WEEKDAYS.map((label, index) => (
                    <label key={label} className={form.weekdays.includes(index) ? 'active' : ''}>
                      <input
                        type="checkbox"
                        checked={form.weekdays.includes(index)}
                        onChange={() => {
                          const next = form.weekdays.includes(index)
                            ? form.weekdays.filter((day) => day !== index)
                            : [...form.weekdays, index]
                          setForm({ ...form, weekdays: next.length ? next : [index] })
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
              {form.freq === 'monthly' && (
                <label>
                  Day of month
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={form.monthday}
                    onChange={(event) => setForm({ ...form, monthday: event.target.value })}
                  />
                </label>
              )}
              <label>
                Start date
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                />
              </label>
              <div className="modal-actions">
                <button className="ghost" type="button" onClick={() => setFormOpen(false)}>
                  Cancel
                </button>
                <button className="primary" type="submit">Create chore</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="modal-backdrop" onClick={() => setEditOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit chore</h2>
              <button className="ghost" onClick={() => setEditOpen(false)} type="button">Close</button>
            </div>
            <form className="task-form" onSubmit={handleUpdateTask}>
              <label>
                Title
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(event) => setEditForm({ ...editForm, title: event.target.value })}
                  required
                />
              </label>
              <label>
                Notes
                <textarea
                  value={editForm.notes}
                  onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
                  rows={3}
                />
              </label>
              <div className="form-row">
                <label>
                  Assignee
                  <select
                    value={editForm.assigneeId}
                    onChange={(event) => setEditForm({ ...editForm, assigneeId: event.target.value })}
                  >
                    <option value="">Anyone</option>
                    {monthData.people?.map((person) => (
                      <option key={person.id} value={person.id}>{person.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={editForm.priority}
                    onChange={(event) => setEditForm({ ...editForm, priority: event.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>
                  Task color
                  <input
                    type="color"
                    value={editForm.color}
                    onChange={(event) => setEditForm({ ...editForm, color: event.target.value })}
                    aria-label="Pick task color"
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Frequency
                  <select
                    value={editForm.freq}
                    onChange={(event) => setEditForm({ ...editForm, freq: event.target.value })}
                  >
                    <option value="once">One-time</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                {editForm.freq !== 'once' && (
                  <label>
                    Interval
                    <input
                      type="number"
                      min="1"
                      value={editForm.interval}
                      onChange={(event) => setEditForm({ ...editForm, interval: event.target.value })}
                    />
                  </label>
                )}
              </div>
              {editForm.freq === 'weekly' && (
                <div className="weekday-picker">
                  {WEEKDAYS.map((label, index) => (
                    <label key={label} className={editForm.weekdays.includes(index) ? 'active' : ''}>
                      <input
                        type="checkbox"
                        checked={editForm.weekdays.includes(index)}
                        onChange={() => {
                          const next = editForm.weekdays.includes(index)
                            ? editForm.weekdays.filter((day) => day !== index)
                            : [...editForm.weekdays, index]
                          setEditForm({ ...editForm, weekdays: next.length ? next : [index] })
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
              {editForm.freq === 'monthly' && (
                <label>
                  Day of month
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={editForm.monthday}
                    onChange={(event) => setEditForm({ ...editForm, monthday: event.target.value })}
                  />
                </label>
              )}
              <label>
                Start date
                <input
                  type="date"
                  value={editForm.startDate}
                  onChange={(event) => setEditForm({ ...editForm, startDate: event.target.value })}
                />
              </label>
              <label className="status-toggle">
                <input
                  type="checkbox"
                  checked={editingStatus === 'done'}
                  onChange={(event) => setEditingStatus(event.target.checked ? 'done' : 'open')}
                />
                Mark this day as done
              </label>
              <div className="modal-actions">
                <button className="ghost danger" type="button" onClick={handleDeleteTask}>
                  Delete entirely
                </button>
                <button className="ghost" type="button" onClick={handleStopFromDate}>
                  Stop from this day
                </button>
                <button className="primary" type="submit">Save changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {peopleOpen && (
        <div className="modal-backdrop" onClick={() => setPeopleOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Household members</h2>
              <button className="ghost" onClick={() => setPeopleOpen(false)} type="button">Close</button>
            </div>
            <div className="people-list">
              {monthData.people?.length === 0 && <p className="muted">No members yet.</p>}
              {monthData.people?.map((person) => (
                <div key={person.id} className="person">
                  <span className="dot" style={{ background: person.color }} />
                  <span>{person.name}</span>
                  <button
                    type="button"
                    className="ghost tiny"
                    onClick={() => handleDeletePerson(person.id, person.name)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <form className="person-form" onSubmit={handleAddPerson}>
              <input
                type="text"
                placeholder="Add member"
                value={personForm.name}
                onChange={(event) => setPersonForm({ ...personForm, name: event.target.value })}
              />
              <input
                type="color"
                value={personForm.color}
                onChange={(event) => setPersonForm({ ...personForm, color: event.target.value })}
                aria-label="Pick color"
              />
              <button className="ghost" type="submit">Add</button>
            </form>
          </div>
        </div>
      )}

      {actionItem && (
        <div className="modal-backdrop" onClick={() => setActionItem(null)}>
          <div className="modal action-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{actionItem.title}</h2>
              <button className="ghost" onClick={() => setActionItem(null)} type="button">Close</button>
            </div>
            <div className="modal-actions">
              <button
                className="ghost"
                type="button"
                onClick={async () => {
                  await handleToggleStatus(actionItem)
                  setActionItem(null)
                }}
              >
                {actionItem.status === 'done' ? 'Mark open' : 'Complete'}
              </button>
              <button
                className="primary"
                type="button"
                onClick={async () => {
                  await openEditModal(actionItem)
                  setActionItem(null)
                }}
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
