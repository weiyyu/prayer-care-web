import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BookHeart, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, Eye, EyeOff, HeartHandshake, LogOut, MapPin, Menu, MoreHorizontal, Pencil, Plus, Printer, Search, Trash2, UsersRound, X } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { deletePerson, deletePrayer, deleteVisit, isDemo, loadSnapshot, markPrayersChecked, savePerson, savePrayer, saveVisit, setPrayerChecked, setPrayerPinned, setPrayerStatus, supabase } from './data'
import type { CarePerson, CareVisit, PersonDraft, PrayerItem, Snapshot, VisitDraft } from './types'
import { splitPrayerLines } from './prayerLines'

type Page = 'prayers' | 'people' | 'visits'
type Dialog = { kind: 'person'; item?: CarePerson } | { kind: 'prayer'; item?: PrayerItem; personId?: string } | { kind: 'prayerHistory'; item: PrayerItem } | { kind: 'visit'; item?: CareVisit; personId?: string } | { kind: 'visitPreview'; item: CareVisit } | { kind: 'answer'; item: PrayerItem } | null

const empty: Snapshot = { people: [], prayers: [], visits: [], checks: [] }
const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const shortDate = (value: string) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' }) : ''
const nameOf = (people: CarePerson[], id: string) => people.find((person) => person.id === id)?.name ?? '已移除的代禱者'
type PrayerGroup = { personId: string; person?: CarePerson; prayers: PrayerItem[] }

function groupPrayers(prayers: PrayerItem[], people: CarePerson[]): PrayerGroup[] {
  const groups = new Map<string, PrayerGroup>()
  for (const prayer of prayers) {
    if (!groups.has(prayer.person_id)) groups.set(prayer.person_id, { personId: prayer.person_id, person: people.find((person) => person.id === prayer.person_id), prayers: [] })
    groups.get(prayer.person_id)!.prayers.push(prayer)
  }
  return [...groups.values()].map((group) => ({
    ...group,
    prayers: group.prayers.sort((a, b) => a.source_visit_id && a.source_visit_id === b.source_visit_id
      ? (a.source_visit_line ?? 1) - (b.source_visit_line ?? 1) : 0),
  }))
}

function Avatar({ person, size = 'normal' }: { person?: CarePerson; size?: 'normal' | 'large' }) {
  return <div className={`avatar ${size === 'large' ? 'avatar-large' : ''}`}>
    {person?.photo_url ? <img src={person.photo_url} alt={`${person.name}的照片`} /> : <span>{person?.name?.slice(0, 1) || '人'}</span>}
  </div>
}

function IconButton({ title, onClick, children, tone = '' }: { title: string; onClick: () => void; children: ReactNode; tone?: string }) {
  return <button type="button" className={`icon-button ${tone}`} title={title} aria-label={title} onClick={onClick}>{children}</button>
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><h2>{title}</h2><IconButton title="關閉" onClick={onClose}><X size={20} /></IconButton></div>
      {children}
    </section>
  </div>
}

function PersonForm({ item, onClose, onSave }: { item?: CarePerson; onClose: () => void; onSave: (draft: PersonDraft, file: File | null, removePhoto: boolean) => Promise<void> }) {
  const [draft, setDraft] = useState<PersonDraft>({ name: item?.name ?? '', category: item?.category ?? '', is_profiled: item?.is_profiled ?? true, birthday: item?.birthday ?? null, residence: item?.residence ?? '', feeling: item?.feeling ?? '' })
  const [file, setFile] = useState<File | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const update = (field: keyof PersonDraft, value: string | boolean | null) => setDraft((old) => ({ ...old, [field]: value }))
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { await onSave(draft, file, removePhoto) } finally { setBusy(false) } }
  return <Modal title={item ? '編輯代禱者' : '新增代禱者'} onClose={onClose} wide>
    <form onSubmit={submit} className="form-grid">
      <label className="field"><span>姓名或群體名稱 *</span><input required maxLength={120} autoFocus value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：林以恩、眾教會" /></label>
      <label className="field"><span>分類</span><input value={draft.category} onChange={(event) => update('category', event.target.value)} placeholder="朋友、家人、群體..." /></label>
      <label className="check-field full"><input type="checkbox" checked={draft.is_profiled} onChange={(event) => update('is_profiled', event.target.checked)} /><span>建立完整關懷檔案</span></label>
      {draft.is_profiled && <>
        <label className="field"><span>生日</span><input type="date" value={draft.birthday ?? ''} onChange={(event) => update('birthday', event.target.value || null)} /></label>
        <label className="field"><span>住處</span><input value={draft.residence} onChange={(event) => update('residence', event.target.value)} placeholder="可留空" /></label>
        <label className="field full"><span>照片</span><input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={removePhoto} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>每位代禱者保留一張照片；換照會覆寫原檔。JPG、PNG 或 WebP，最多 5 MB。</small></label>
        {(item?.photo_path || item?.photo_url) && <label className="check-field full"><input type="checkbox" checked={removePhoto} onChange={(event) => { setRemovePhoto(event.target.checked); if (event.target.checked) { setFile(null); if (photoInput.current) photoInput.current.value = '' } }} /><span>移除目前照片（保留代禱者資料）</span></label>}
        <label className="field full"><span>感動與提醒</span><textarea rows={4} value={draft.feeling} onChange={(event) => update('feeling', event.target.value)} placeholder="記下關懷時領受的感動..." /></label>
      </>}
      <div className="form-actions full"><button type="button" className="button-quiet" onClick={onClose}>取消</button><button className="button-primary" disabled={busy}>{busy ? '儲存中...' : '儲存檔案'}</button></div>
    </form>
  </Modal>
}

function PrayerForm({ item, people, personId, onClose, onSave }: { item?: PrayerItem; people: CarePerson[]; personId?: string; onClose: () => void; onSave: (personId: string, request: string) => Promise<void> }) {
  const [chosen, setChosen] = useState(item?.person_id ?? personId ?? people[0]?.id ?? '')
  const [request, setRequest] = useState(item?.request ?? '')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { await onSave(chosen, request) } finally { setBusy(false) } }
  return <Modal title={item ? '編輯代禱事項' : '新增代禱事項'} onClose={onClose} wide>
    <form onSubmit={submit} className="form-stack">
      <label className="field"><span>代禱者 *</span><select required value={chosen} onChange={(event) => setChosen(event.target.value)}><option value="">請選擇</option>{people.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.category || '未分類'}</option>)}</select></label>
      <p className="field-help">還沒有這個人？先在「代禱者」建立姓名，群體可以不建完整檔案。</p>
      <label className="field"><span>代禱內容 *</span><textarea required rows={7} autoFocus value={request} onChange={(event) => setRequest(event.target.value)} placeholder="目前可以如何為他禱告？" /></label>
      <div className="form-actions"><button type="button" className="button-quiet" onClick={onClose}>取消</button><button className="button-primary" disabled={busy || !chosen}>{busy ? '儲存中...' : '儲存代禱'}</button></div>
    </form>
  </Modal>
}

function VisitForm({ item, people, personId, onClose, onSave }: { item?: CareVisit; people: CarePerson[]; personId?: string; onClose: () => void; onSave: (draft: VisitDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<VisitDraft>({ person_id: item?.person_id ?? personId ?? people.find((person) => person.is_profiled)?.id ?? '', visit_date: item?.visit_date ?? localDate(), place: item?.place ?? '', family_note: item?.family_note ?? '', work_note: item?.work_note ?? '', spiritual_note: item?.spiritual_note ?? '', prayer_note: item?.prayer_note ?? '' })
  const [busy, setBusy] = useState(false)
  const prayerLines = splitPrayerLines(draft.prayer_note)
  const update = (field: keyof VisitDraft, value: string) => setDraft((old) => ({ ...old, [field]: value }))
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { await onSave(draft) } finally { setBusy(false) } }
  return <Modal title={item ? '編輯關懷訪談' : '新增關懷訪談'} onClose={onClose} wide>
    <form onSubmit={submit} className="form-grid">
      <label className="field"><span>代禱者 *</span><select required value={draft.person_id} onChange={(event) => update('person_id', event.target.value)}><option value="">請選擇</option>{people.filter((person) => person.is_profiled).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
      <label className="field"><span>訪談日期 *</span><input required type="date" value={draft.visit_date} onChange={(event) => update('visit_date', event.target.value)} /></label>
      <label className="field full"><span>地點</span><input value={draft.place} onChange={(event) => update('place', event.target.value)} placeholder="可留空" /></label>
      {([['family_note', '家庭'], ['work_note', '工作'], ['spiritual_note', '屬靈']] as const).map(([field, label]) =>
        <label className="field full" key={field}><span>{label}</span><textarea rows={4} value={draft[field]} onChange={(event) => update(field, event.target.value)} placeholder={`記錄${label}的近況...`} /></label>
      )}
      <label className="field full"><span>代禱（每行一項）</span><textarea rows={5} value={draft.prayer_note} onChange={(event) => update('prayer_note', event.target.value)} placeholder={'第一項代禱\n第二項代禱'} /></label>
      {prayerLines.length > 0 && <div className="visit-prayer-preview full"><strong>將同步 {prayerLines.length} 項代禱</strong><ol>{prayerLines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol></div>}
      <div className="form-actions full"><button type="button" className="button-quiet" onClick={onClose}>取消</button><button className="button-primary" disabled={busy}>{busy ? '儲存中...' : '儲存訪談'}</button></div>
    </form>
  </Modal>
}

function VisitPreview({ item, personName, onClose, onEdit }: { item: CareVisit; personName: string; onClose: () => void; onEdit: () => void }) {
  const sections = ([['家庭', item.family_note], ['工作', item.work_note], ['屬靈', item.spiritual_note], ['代禱', item.prayer_note]] as const).filter(([, value]) => value.trim())
  return <Modal title={`${personName}的關懷紀錄`} onClose={onClose} wide><div className="visit-preview">
    <p className="visit-preview-meta"><CalendarDays size={16} />{shortDate(item.visit_date)}{item.place && <> <MapPin size={16} />{item.place}</>}</p>
    {sections.length ? sections.map(([label, value]) => <section key={label}><h3>{label}</h3><p>{value}</p></section>) : <p className="muted">這次訪談尚未填寫內容</p>}
    <div className="form-actions"><button className="button-quiet" onClick={onClose}>關閉</button><button className="button-primary" onClick={onEdit}><Pencil size={16} /> 編輯紀錄</button></div>
  </div></Modal>
}

function PrayerHistory({ dates, onClose }: { dates: string[]; onClose: () => void }) {
  return <Modal title="禱告紀錄" onClose={onClose}><div className="visit-preview"><p className="muted">已記錄 {dates.length} 天。每天的紀錄彼此獨立，隔天仍可繼續為同一件事禱告。</p><div className="history-list">{dates.map((date) => <div key={date}><Check size={16} />{shortDate(date)}</div>)}</div><div className="form-actions"><button className="button-primary" onClick={onClose}>完成</button></div></div></Modal>
}

function PrayerGroupCard({ group, index, total, checkedToday, onProfile, onAdd, onEdit, onAnswer, onRestore }: { group: PrayerGroup; index: number; total: number; checkedToday: Set<string>; onProfile: () => void; onAdd: () => void; onEdit: (prayer: PrayerItem) => void; onAnswer: (prayer: PrayerItem) => void; onRestore: (prayer: PrayerItem) => void }) {
  return <div className="prayer-card person-prayer-card">
    <div className="card-top"><span>代禱卡 <span className="card-counter">{index + 1} / {total}</span></span><span>{group.prayers.length} 項 · {group.person?.category || '未分類'}</span></div>
    <Avatar person={group.person} size="large" />
    <h2>{group.person?.name || '已移除的代禱者'}</h2>
    <div className="card-prayer-list">{group.prayers.map((prayer, itemIndex) => <div className="card-prayer-item" key={prayer.id}>
      <span className="card-item-number">{String(itemIndex + 1).padStart(2, '0')}</span>
      <p>{prayer.request}</p>
      {prayer.status === 'answered' ? <span className="card-item-state">蒙應允</span> : checkedToday.has(prayer.id) ? <span className="card-item-state is-done"><Check size={14} /> 今天已禱告</span> : null}
      <details className="row-menu card-item-menu"><summary aria-label={`更多操作：第 ${itemIndex + 1} 項代禱`} title="更多操作"><MoreHorizontal size={18} /></summary><div className="row-menu-panel">{prayer.status === 'answered' ? <button onClick={() => onRestore(prayer)}>恢復持續代禱</button> : <button onClick={() => onAnswer(prayer)}>記錄蒙應允</button>}<button onClick={() => onEdit(prayer)}>編輯事項</button></div></details>
    </div>)}</div>
    <div className="card-bottom"><button className="text-button" onClick={onProfile}>查看檔案</button><button className="text-button" onClick={onAdd}><Plus size={16} /> 新增這人的代禱</button></div>
  </div>
}

function FocusPrayer({ groups, index, checkedToday, busy, onClose, onPrevious, onNext, onComplete }: { groups: PrayerGroup[]; index: number; checkedToday: Set<string>; busy: boolean; onClose: () => void; onPrevious: () => void; onNext: () => void; onComplete: (prayers: PrayerItem[]) => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKey) }
  }, [onClose])
  const group = groups[Math.min(index, groups.length - 1)]
  const unmarked = group?.prayers.filter((prayer) => !checkedToday.has(prayer.id)) ?? []
  return <section className="focus-screen" role="dialog" aria-modal="true" aria-label="安靜禱告">
    <header className="focus-header"><div><span className="focus-mark"><HeartHandshake size={21} /></span><span>禱告祭壇 <small>安靜禱告</small></span></div><button className="focus-close" onClick={onClose} aria-label="結束安靜禱告" title="結束安靜禱告"><X size={22} /></button></header>
    {group ? <>
      <div className="focus-body"><div className="focus-person"><Avatar person={group.person} size="large" /><div><span>{group.person?.category || '未分類'} · {index + 1} / {groups.length}</span><h1>{group.person?.name || '已移除的代禱者'}</h1></div></div>
        <div className="focus-prayers">{group.prayers.map((prayer, itemIndex) => <div className="focus-prayer" key={prayer.id}><span className="focus-number">{String(itemIndex + 1).padStart(2, '0')}</span><p>{prayer.request}</p>{checkedToday.has(prayer.id) && <Check size={19} aria-label="今天已禱告" />}</div>)}</div>
      </div>
      <footer className="focus-footer"><button className="focus-step" onClick={onPrevious} aria-label="上一位代禱者"><ChevronLeft size={20} /><span>上一位</span></button><button className="button-primary focus-complete" disabled={busy || !unmarked.length} onClick={() => onComplete(unmarked)}><Check size={19} />{unmarked.length ? `記下今日禱告 · ${unmarked.length} 項` : '今天已完成'}</button><button className="focus-step" onClick={onNext} aria-label="下一位代禱者"><span>下一位</span><ChevronRight size={20} /></button></footer>
    </> : <div className="focus-empty"><HeartHandshake size={34} /><h1>目前沒有持續代禱的事項</h1><button className="button-quiet" onClick={onClose}>返回清單</button></div>}
  </section>
}

function PrintSheet({ groups, label, date }: { groups: PrayerGroup[]; label: string; date: string }) {
  return <div className="print-sheet"><header><h1>禱告祭壇</h1><p>{label} · {shortDate(date)}</p></header>{groups.map((group) => <section className="print-person" key={group.personId}><div className="print-person-head"><h2>{group.person?.name || '已移除的代禱者'}</h2><span>{group.person?.category || '未分類'}</span></div><ol>{group.prayers.map((prayer) => <li key={prayer.id}><span className="print-check" /> <span>{prayer.request}</span></li>)}</ol></section>)}<footer>禱告祭壇 · 私人代禱清單</footer></div>
}

type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset'

function AuthGate({ recovering = false, onRecovered, onCancelRecovery }: { recovering?: boolean; onRecovered: () => void; onCancelRecovery: () => void }) {
  const [selectedMode, setSelectedMode] = useState<Exclude<AuthMode, 'reset'>>('signin')
  const mode: AuthMode = recovering ? 'reset' : selectedMode
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).toString()
  const changeMode = (next: Exclude<AuthMode, 'reset'>) => {
    setSelectedMode(next)
    setPassword('')
    setConfirmation('')
    setShowPassword(false)
    setFeedback(null)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if ((mode === 'signup' || mode === 'reset') && password !== confirmation) {
      setFeedback({ text: '兩次輸入的密碼不一致', error: true })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      if (mode === 'forgot') {
        const { error } = await supabase!.auth.resetPasswordForEmail(email.trim(), { redirectTo })
        if (error) throw error
        setFeedback({ text: '若此信箱已註冊，重設密碼連結會寄到你的信箱。', error: false })
        return
      }
      if (mode === 'reset') {
        const { error } = await supabase!.auth.updateUser({ password })
        if (error) throw error
        onRecovered()
        return
      }
      if (mode === 'signup') {
        const { error } = await supabase!.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo } })
        if (error) throw error
        setPassword('')
        setConfirmation('')
        setFeedback({ text: '註冊已送出。請至信箱完成驗證，再用帳密登入。', error: false })
        return
      }
      const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失敗，請稍後再試'
      const readable = /email address not authorized/i.test(message) ? '目前測試寄信只支援 Supabase 專案團隊的信箱。公開註冊前需設定寄信服務。'
        : /invalid login credentials/i.test(message) ? '帳號或密碼錯誤，或信箱尚未驗證。'
        : /email not confirmed/i.test(message) ? '請先到信箱完成驗證，再登入。'
        : /rate limit/i.test(message) ? '操作太頻繁，請稍後再試。'
        : message
      setFeedback({ text: readable, error: true })
    }
    finally { setBusy(false) }
  }
  return <main className="auth-screen"><div className="auth-panel"><img src={`${import.meta.env.BASE_URL}brand-icon.png`} alt="禱告祭壇" className="auth-logo" /><div className="eyebrow">禱告祭壇 · PRAYER ALTAR</div><h1>{mode === 'reset' ? '設定新密碼' : '把關懷，帶進禱告裡。'}</h1><p>{mode === 'reset' ? '請為你的帳號設定新密碼。' : '登入後，只會看到自己建檔的代禱者、代禱事項與訪談紀錄。'}</p>
    {(mode === 'signin' || mode === 'signup') && <div className="auth-tabs" role="tablist" aria-label="帳號操作"><button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => changeMode('signin')}>登入</button><button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => changeMode('signup')}>註冊</button></div>}
    {mode === 'forgot' && <h2 className="auth-subtitle">忘記密碼</h2>}
    <form onSubmit={submit}>
      {mode !== 'reset' && <label className="field"><span>電子郵件</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>}
      {mode !== 'forgot' && <label className="field"><span>{mode === 'reset' ? '新密碼' : '密碼'}</span><span className="password-field"><input required type={showPassword ? 'text' : 'password'} minLength={mode === 'signin' ? undefined : 8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'signin' ? '輸入密碼' : '至少 8 個字元'} /><button type="button" className="password-toggle" aria-label={showPassword ? '隱藏密碼' : '顯示密碼'} title={showPassword ? '隱藏密碼' : '顯示密碼'} onClick={() => setShowPassword((old) => !old)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>}
      {(mode === 'signup' || mode === 'reset') && <label className="field"><span>確認密碼</span><input required type={showPassword ? 'text' : 'password'} minLength={8} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="再次輸入密碼" /></label>}
      {mode === 'signin' && <button type="button" className="auth-link auth-forgot" onClick={() => changeMode('forgot')}>忘記密碼？</button>}
      <button className="button-primary auth-submit" disabled={busy}>{busy ? '處理中...' : mode === 'signin' ? '登入' : mode === 'signup' ? '建立帳號' : mode === 'forgot' ? '寄送重設連結' : '儲存新密碼'}</button>
    </form>
    {feedback && <p className={`auth-message ${feedback.error ? 'auth-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    {mode === 'forgot' && <button type="button" className="auth-link auth-back" onClick={() => changeMode('signin')}>返回登入</button>}
    {mode === 'reset' && <button type="button" className="auth-link auth-back" onClick={onCancelRecovery}>取消並返回登入</button>}
  </div></main>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(isDemo)
  const [recovering, setRecovering] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot>(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [today, setToday] = useState(localDate)
  const [page, setPage] = useState<Page>('prayers')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [status, setStatus] = useState<'active' | 'answered'>('active')
  const [mode, setMode] = useState<'list' | 'cards'>('list')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [cardIndex, setCardIndex] = useState(0)
  const [focusOpen, setFocusOpen] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)
  const [focusBusy, setFocusBusy] = useState(false)
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [mobileMenu, setMobileMenu] = useState(false)
  const activeOwner = useRef<string | null>(isDemo ? 'demo' : null)
  const loadVersion = useRef(0)

  useEffect(() => { const timer = window.setInterval(() => setToday(localDate()), 60000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3500); return () => window.clearTimeout(timer) }, [notice])
  const reload = useCallback(async (quiet = false) => {
    const owner = activeOwner.current
    if (!owner) return
    const version = ++loadVersion.current
    if (!quiet) setLoading(true)
    try {
      const next = await loadSnapshot()
      if (activeOwner.current !== owner || loadVersion.current !== version) {
        next.people.forEach((person) => { if (person.photo_url?.startsWith('blob:')) URL.revokeObjectURL(person.photo_url) })
        return
      }
      setSnapshot((previous) => {
        const retained = new Set(next.people.map((person) => person.photo_url))
        previous.people.forEach((person) => { if (person.photo_url?.startsWith('blob:') && !retained.has(person.photo_url)) URL.revokeObjectURL(person.photo_url) })
        return next
      })
      setError('')
    } catch (e) {
      if (activeOwner.current === owner && loadVersion.current === version) setError(e instanceof Error ? e.message : '資料載入失敗')
    } finally {
      if (activeOwner.current === owner && loadVersion.current === version) setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (isDemo) return
    const { data } = supabase!.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') setRecovering(false)
      const nextOwner = next?.user.id ?? null
      if (nextOwner !== activeOwner.current) {
        activeOwner.current = nextOwner
        loadVersion.current++
        setSnapshot((previous) => {
          previous.people.forEach((person) => { if (person.photo_url?.startsWith('blob:')) URL.revokeObjectURL(person.photo_url) })
          return empty
        })
        setDialog(null)
      }
      setSession(next)
      setAuthReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => { if (authReady && (isDemo || (session && !recovering))) void reload(); else if (authReady) setLoading(false) }, [authReady, session?.user.id, recovering, reload])

  const operate = useCallback(async (action: () => Promise<void>, message = '已儲存') => { try { await action(); setDialog(null); await reload(true); setNotice(message); return true } catch (e) { await reload(true); setError(e instanceof Error ? e.message : '操作失敗'); return false } }, [reload])
  const categories = useMemo(() => Array.from(new Set(snapshot.people.map((person) => person.category).filter(Boolean))).sort(), [snapshot.people])
  const filteredPrayers = useMemo(() => snapshot.prayers.filter((prayer) => {
    const person = snapshot.people.find((candidate) => candidate.id === prayer.person_id)
    const matchesCategory = category === 'all' || person?.category === category
    const haystack = `${person?.name ?? ''} ${person?.category ?? ''} ${prayer.request} ${prayer.answered_note}`.toLocaleLowerCase()
    return (status === 'active' ? prayer.status !== 'answered' : prayer.status === 'answered') && matchesCategory && haystack.includes(query.toLocaleLowerCase())
  }).sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.created_at.localeCompare(a.created_at)), [snapshot, status, category, query])
  const prayerGroups = useMemo(() => groupPrayers(filteredPrayers, snapshot.people), [filteredPrayers, snapshot.people])
  const focusGroups = useMemo(() => groupPrayers(snapshot.prayers.filter((prayer) => {
    const person = snapshot.people.find((candidate) => candidate.id === prayer.person_id)
    return prayer.status !== 'answered' && (category === 'all' || person?.category === category) &&
      `${person?.name ?? ''} ${person?.category ?? ''} ${prayer.request}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  }).sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.created_at.localeCompare(a.created_at)), snapshot.people), [snapshot, category, query])
  const filteredPeople = useMemo(() => snapshot.people.filter((person) => (category === 'all' || person.category === category) && `${person.name} ${person.category} ${person.residence} ${person.feeling}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [snapshot.people, category, query])
  const filteredVisits = useMemo(() => snapshot.visits.filter((visit) => (category === 'all' || snapshot.people.find((person) => person.id === visit.person_id)?.category === category) && `${nameOf(snapshot.people, visit.person_id)} ${visit.place} ${visit.family_note} ${visit.work_note} ${visit.spiritual_note} ${visit.prayer_note}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.visit_date.localeCompare(a.visit_date)), [snapshot, category, query])
  const selectedPerson = snapshot.people.find((person) => person.id === selectedPersonId)
  const currentGroup = prayerGroups[Math.min(cardIndex, prayerGroups.length - 1)]
  const checkedToday = new Set(snapshot.checks.filter((item) => item.prayed_on === today).map((item) => item.prayer_id))
  const count = (value: 'active' | 'answered') => snapshot.prayers.filter((item) => value === 'active' ? item.status !== 'answered' : item.status === 'answered').length
  const nav = [{ page: 'prayers' as const, label: '代禱事項', icon: HeartHandshake }, { page: 'people' as const, label: '代禱者', icon: UsersRound }, { page: 'visits' as const, label: '關懷訪談', icon: ClipboardList }]
  function go(next: Page) { setPage(next); setQuery(''); setCategory('all'); setSelectedPersonId(next === 'people' && !window.matchMedia('(max-width:650px)').matches ? snapshot.people[0]?.id ?? null : null); setMobileMenu(false) }
  function confirmDelete(label: string, action: () => Promise<void>) { if (window.confirm(`確定刪除「${label}」嗎？刪除後無法復原。`)) void operate(action) }
  function startPrayer() {
    const next = focusGroups.findIndex((group) => group.prayers.some((prayer) => !checkedToday.has(prayer.id)))
    setFocusIndex(next < 0 ? 0 : next)
    setFocusOpen(true)
  }
  async function completePerson(prayers: PrayerItem[]) {
    setFocusBusy(true)
    try { await operate(() => markPrayersChecked(prayers, today), `已記下 ${prayers.length} 項今日禱告`) }
    finally { setFocusBusy(false) }
  }
  function printPrayers() {
    if (!filteredPrayers.length) { setNotice('目前清單沒有可列印的代禱事項'); return }
    window.print()
  }

  if (!authReady) return <div className="loading-screen">正在確認登入...</div>
  if (!isDemo && (recovering || !session)) return <AuthGate recovering={recovering} onRecovered={() => setRecovering(false)} onCancelRecovery={() => { void supabase!.auth.signOut() }} />

  return <><div className="app-shell" inert={focusOpen}>
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <div className="brand"><img src={`${import.meta.env.BASE_URL}brand-icon.png`} alt="" /><span><strong>禱告祭壇</strong><small>PRAYER ALTAR</small></span></div>
      <nav aria-label="主要導覽">{nav.map(({ page: next, label, icon: Icon }) => <button type="button" key={next} className={`nav-link ${page === next ? 'selected' : ''}`} onClick={() => go(next)}><Icon size={20} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-foot"><CircleHelp size={18} /><span>{isDemo ? '本機示範模式' : session?.user.email}</span></div>
      {!isDemo && <button type="button" className="nav-link signout" onClick={() => { void supabase!.auth.signOut() }}><LogOut size={18} /><span>登出</span></button>}
    </aside>
    <div className="workspace">
      <header className="topbar"><IconButton title="開啟選單" onClick={() => setMobileMenu(!mobileMenu)} tone="mobile-menu"><Menu size={21} /></IconButton><div className="topbar-path">關懷工作台 <ChevronRight size={15} /> <strong>{nav.find((item) => item.page === page)?.label}</strong></div><div className="topbar-right"><span>{new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' })}</span>{!isDemo && <IconButton title="登出" onClick={() => { void supabase!.auth.signOut() }} tone="mobile-signout"><LogOut size={18} /></IconButton>}</div></header>
      {isDemo && <div className="demo-banner"><strong>示範模式</strong> 目前使用虛構資料，重新整理會清空剛才的修改。請勿輸入真實的關懷隱私。</div>}
      {error && <div className="error-banner" role="alert">{error}<IconButton title="關閉訊息" onClick={() => setError('')}><X size={18} /></IconButton></div>}
      {notice && <div className="notice-banner" role="status"><Check size={16} />{notice}</div>}
      <main className="main-content">
        <div className="page-heading"><div><div className="eyebrow">PRAYER ALTAR</div><h1>{page === 'prayers' ? '代禱事項' : page === 'people' ? '代禱者' : '關懷訪談'}</h1><p>{page === 'prayers' ? '安靜記下需要，也記得回望蒙應允的恩典。' : page === 'people' ? '每個名字背後，都是一段值得細心陪伴的生命。' : '把每一次談話，整理成下一次關懷的起點。'}</p></div><button className="button-primary add-button" aria-label={page === 'prayers' ? '新增代禱' : page === 'people' ? '新增代禱者' : '新增訪談'} onClick={() => setDialog(page === 'people' ? { kind: 'person' } : page === 'visits' ? { kind: 'visit' } : snapshot.people.length ? { kind: 'prayer' } : { kind: 'person' })}><Plus size={19} /><span>{page === 'prayers' ? '新增代禱' : page === 'people' ? '新增代禱者' : '新增訪談'}</span></button></div>
        {page === 'prayers' && <div className="prayer-entry"><div><span className="prayer-entry-icon"><HeartHandshake size={23} /></span><span><strong>安靜禱告</strong><small>{focusGroups.length} 位代禱者 · {focusGroups.reduce((sum, group) => sum + group.prayers.length, 0)} 項代禱</small></span></div><div className="prayer-entry-actions"><button className="button-primary" onClick={startPrayer}>開始禱告 <ChevronRight size={17} /></button><button className="button-quiet" onClick={printPrayers} title="列印或存成 PDF"><Printer size={17} /> <span>列印 / PDF</span></button></div></div>}
        {page === 'prayers' && <div className="summary-strip"><div><span className="summary-icon green"><HeartHandshake size={21} /></span><span><strong>{count('active')}</strong><small>持續代禱</small></span></div><div><span className="summary-icon plum"><Check size={21} /></span><span><strong>{snapshot.checks.filter((item) => item.prayed_on === today).length}</strong><small>今日已禱告</small></span></div><div><span className="summary-icon gold"><BookHeart size={21} /></span><span><strong>{count('answered')}</strong><small>蒙應允</small></span></div></div>}
        <div className="toolbar"><div className="search-box"><Search size={19} /><input aria-label="搜尋" value={query} onChange={(event) => { setQuery(event.target.value); setCardIndex(0) }} placeholder={page === 'prayers' ? '搜尋姓名或代禱內容' : page === 'people' ? '搜尋姓名、分類或感動' : '搜尋訪談內容'} />{query && <IconButton title="清除搜尋" onClick={() => setQuery('')}><X size={17} /></IconButton>}</div><div className="select-wrap"><select aria-label="篩選分類" value={category} onChange={(event) => { setCategory(event.target.value); setCardIndex(0) }}><option value="all">所有分類</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select><ChevronDown size={16} /></div></div>
        {loading ? <div className="loading-inline">正在整理資料...</div> : page === 'prayers' ? <>
          <div className="section-tabs"><div role="tablist" aria-label="代禱狀態">{(['active', 'answered'] as const).map((value) => <button type="button" role="tab" aria-selected={status === value} className={status === value ? 'active' : ''} key={value} onClick={() => { setStatus(value); setCardIndex(0) }}>{value === 'active' ? '持續代禱' : '蒙應允'} <span>{count(value)}</span></button>)}</div><div className="mode-switch"><button type="button" className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>清單</button><button type="button" className={mode === 'cards' ? 'active' : ''} onClick={() => setMode('cards')}>代禱卡</button></div></div>
          {mode === 'list' ? filteredPrayers.length ? <div className="prayer-list">{filteredPrayers.map((prayer) => {
            const person = snapshot.people.find((item) => item.id === prayer.person_id)
            const history = snapshot.checks.filter((item) => item.prayer_id === prayer.id)
            const doneToday = checkedToday.has(prayer.id)
            return <article className="prayer-row" key={prayer.id}>
              <Avatar person={person} />
              <div className="prayer-row-body">
                <div className="row-title"><strong>{person?.name}</strong><span className="category-label">{person?.category || '未分類'}</span>{prayer.source_visit_id && <span className="source-label">訪談連動</span>}</div>
                <p>{prayer.request}</p>
                {prayer.status === 'answered' && prayer.answered_note && <p className="answered-note">回望：{prayer.answered_note}</p>}
                {prayer.status !== 'answered' && <div className="prayer-row-bottom"><button className={`prayed-button ${doneToday ? 'is-done' : ''}`} aria-pressed={doneToday} onClick={() => void operate(() => setPrayerChecked(prayer, today, doneToday), doneToday ? '已取消今天的紀錄' : '已記下今天的禱告')}><Check size={17} />{doneToday ? '今天已禱告' : '記下今日禱告'}</button>{history.length ? <button className="prayer-history" onClick={() => setDialog({ kind: 'prayerHistory', item: prayer })}>累計 {history.length} 天 · 上次 {shortDate(history[0].prayed_on)}</button> : <span className="prayer-history-empty">尚未記錄禱告</span>}</div>}
              </div>
              <details className="row-menu"><summary aria-label={`更多操作：${person?.name || '代禱事項'}`} title="更多操作"><MoreHorizontal size={20} /></summary><div className="row-menu-panel">{prayer.status !== 'answered' ? <button onClick={() => setDialog({ kind: 'answer', item: prayer })}>記錄蒙應允</button> : <button onClick={() => void operate(() => setPrayerStatus(prayer, 'active'), '已恢復持續代禱')}>恢復持續代禱</button>}<button onClick={() => setDialog({ kind: 'prayer', item: prayer })}>編輯事項</button><button onClick={() => void operate(() => setPrayerPinned(prayer, !prayer.is_pinned), prayer.is_pinned ? '已取消置頂' : '已置頂')}>{prayer.is_pinned ? '取消置頂' : '置頂'}</button><button className="danger-text" onClick={() => confirmDelete('代禱事項', () => deletePrayer(prayer))}>刪除事項</button></div></details>
            </article>
          })}</div> : <EmptyState text={query ? '找不到相符的代禱事項' : `目前沒有${status === 'active' ? '持續代禱' : '蒙應允'}的事項`} action="新增代禱" onClick={() => setDialog(snapshot.people.length ? { kind: 'prayer' } : { kind: 'person' })} />
            : prayerGroups.length && currentGroup ? <div className="card-area">
              <PrayerGroupCard group={currentGroup} index={Math.min(cardIndex, prayerGroups.length - 1)} total={prayerGroups.length} checkedToday={checkedToday} onProfile={() => { go('people'); setSelectedPersonId(currentGroup.personId) }} onAdd={() => setDialog({ kind: 'prayer', personId: currentGroup.personId })} onEdit={(prayer) => setDialog({ kind: 'prayer', item: prayer })} onAnswer={(prayer) => setDialog({ kind: 'answer', item: prayer })} onRestore={(prayer) => void operate(() => setPrayerStatus(prayer, 'active'), '已恢復持續代禱')} />
              <div className="card-controls"><button className="button-quiet" onClick={() => setCardIndex((index) => (index - 1 + prayerGroups.length) % prayerGroups.length)}><ChevronLeft size={18} /> 上一位</button>
                {status === 'active' && <button className="button-primary" disabled={currentGroup.prayers.every((prayer) => checkedToday.has(prayer.id))} onClick={() => void operate(() => markPrayersChecked(currentGroup.prayers.filter((prayer) => !checkedToday.has(prayer.id)), today), '已記下今天的禱告')}><Check size={17} />{currentGroup.prayers.every((prayer) => checkedToday.has(prayer.id)) ? '今天已完成' : '記下今日禱告'}</button>}
                <button className="button-quiet" onClick={() => setCardIndex((index) => (index + 1) % prayerGroups.length)}>下一位 <ChevronRight size={18} /></button></div>
            </div> : <EmptyState text={`目前沒有${status === 'active' ? '持續代禱' : '蒙應允'}的事項`} action="新增代禱" onClick={() => setDialog(snapshot.people.length ? { kind: 'prayer' } : { kind: 'person' })} />}
        </> : page === 'people' ? <>
          <div className="list-meta">共 {filteredPeople.length} 位代禱者</div>
          <div className={`people-layout ${selectedPerson ? 'has-selection' : ''}`}><div className="people-list">{filteredPeople.length ? filteredPeople.map((person) => <button type="button" className={`person-row ${selectedPersonId === person.id ? 'selected' : ''}`} key={person.id} onClick={() => setSelectedPersonId(person.id)}><Avatar person={person} /><span><strong>{person.name}</strong><small>{person.category || '未分類'} · {snapshot.prayers.filter((prayer) => prayer.person_id === person.id && prayer.status !== 'answered').length} 項持續代禱</small></span><ChevronRight size={17} /></button>) : <EmptyState text="還沒有代禱者" action="新增代禱者" onClick={() => setDialog({ kind: 'person' })} />}</div>
            <div className="person-detail">{selectedPerson ? <>
              <button className="person-back" onClick={() => setSelectedPersonId(null)}><ChevronLeft size={18} /> 代禱者清單</button>
              <div className="detail-head"><Avatar person={selectedPerson} size="large" /><div><span className="eyebrow">關懷檔案</span><h2>{selectedPerson.name}</h2><span className="category-label">{selectedPerson.category || '未分類'}</span>{!selectedPerson.is_profiled && <span className="source-label">簡易姓名</span>}</div><div className="detail-menu"><IconButton title="編輯檔案" onClick={() => setDialog({ kind: 'person', item: selectedPerson })}><Pencil size={18} /></IconButton><IconButton title="刪除代禱者" onClick={() => confirmDelete(`${selectedPerson.name}及所有相關資料`, () => deletePerson(selectedPerson))} tone="danger-text"><Trash2 size={18} /></IconButton></div></div>
              <div className="detail-facts">{selectedPerson.birthday && <span><CalendarDays size={16} /> {shortDate(selectedPerson.birthday)}</span>}{selectedPerson.residence && <span><MapPin size={16} /> {selectedPerson.residence}</span>}{snapshot.visits.some((visit) => visit.person_id === selectedPerson.id) && <span><CalendarDays size={16} /> 最近關懷 {shortDate(snapshot.visits.filter((visit) => visit.person_id === selectedPerson.id).sort((a, b) => b.visit_date.localeCompare(a.visit_date))[0].visit_date)}</span>}</div>
              {selectedPerson.feeling && <section className="detail-section"><h3>感動與提醒</h3><p>{selectedPerson.feeling}</p></section>}
              <section className="detail-section"><div className="section-title"><h3>代禱事項</h3><button className="mini-add" onClick={() => setDialog({ kind: 'prayer', personId: selectedPerson.id })}><Plus size={16} /> 新增</button></div>{snapshot.prayers.filter((prayer) => prayer.person_id === selectedPerson.id).map((prayer) => <div className="detail-item" key={prayer.id}><span className={`status-dot ${prayer.status}`} /><span>{prayer.request}</span><small>{prayer.status === 'answered' ? '蒙應允' : checkedToday.has(prayer.id) ? '今天已禱告' : '持續代禱'}</small></div>)}{!snapshot.prayers.some((prayer) => prayer.person_id === selectedPerson.id) && <p className="muted">還沒有代禱事項</p>}</section>
              {selectedPerson.is_profiled && <section className="detail-section"><div className="section-title"><h3>關懷訪談</h3><button className="mini-add" onClick={() => setDialog({ kind: 'visit', personId: selectedPerson.id })}><Plus size={16} /> 新增</button></div>{snapshot.visits.filter((visit) => visit.person_id === selectedPerson.id).sort((a, b) => b.visit_date.localeCompare(a.visit_date)).slice(0, 3).map((visit) => <button className="visit-link" key={visit.id} onClick={() => setDialog({ kind: 'visitPreview', item: visit })}><CalendarDays size={16} /> {shortDate(visit.visit_date)} {visit.place && `· ${visit.place}`} <ChevronRight size={16} /></button>)}{!snapshot.visits.some((visit) => visit.person_id === selectedPerson.id) && <p className="muted">尚未記錄訪談</p>}</section>}
            </> : <div className="detail-placeholder"><UsersRound size={34} /><h3>選一位代禱者</h3><p>在這裡查看關懷檔案、代禱事項和訪談紀錄。</p></div>}</div></div>
        </> : <><div className="list-meta">共 {filteredVisits.length} 次訪談</div>{filteredVisits.length ? <div className="visit-list">{filteredVisits.map((visit) => <article className="visit-row" key={visit.id}>
          <div className="visit-date"><CalendarDays size={18} /><span>{shortDate(visit.visit_date)}</span></div>
          <div className="visit-body"><h2>{nameOf(snapshot.people, visit.person_id)}</h2>{visit.place && <p className="visit-place"><MapPin size={15} />{visit.place}</p>}<p className="visit-excerpt">{visit.family_note || visit.work_note || visit.spiritual_note || visit.prayer_note || '這次訪談尚未填寫內容'}</p><div className="visit-actions"><button className="visit-open" onClick={() => setDialog({ kind: 'visitPreview', item: visit })}>閱讀紀錄 <ChevronRight size={17} /></button><details className="row-menu"><summary aria-label="更多訪談操作" title="更多操作"><MoreHorizontal size={20} /></summary><div className="row-menu-panel"><button onClick={() => setDialog({ kind: 'visit', item: visit })}>編輯訪談</button><button className="danger-text" onClick={() => confirmDelete('這次訪談', () => deleteVisit(visit))}>刪除訪談</button></div></details></div></div>
        </article>)}</div> : <EmptyState text={query ? '找不到相符的訪談' : '還沒有訪談紀錄'} action="新增訪談" onClick={() => setDialog({ kind: 'visit' })} />}</>}
      </main>
    </div>
    {dialog?.kind === 'person' && <PersonForm item={dialog.item} onClose={() => setDialog(null)} onSave={async (draft, file, removePhoto) => { await operate(() => savePerson(draft, dialog.item, file, removePhoto)) }} />}
    {dialog?.kind === 'prayer' && <PrayerForm item={dialog.item} people={snapshot.people} personId={dialog.personId} onClose={() => setDialog(null)} onSave={async (personId, request) => { await operate(() => savePrayer(personId, request, dialog.item)) }} />}
    {dialog?.kind === 'visit' && <VisitForm item={dialog.item} people={snapshot.people} personId={dialog.personId} onClose={() => setDialog(null)} onSave={async (draft) => { await operate(() => saveVisit(draft, dialog.item)) }} />}
    {dialog?.kind === 'visitPreview' && <VisitPreview item={dialog.item} personName={nameOf(snapshot.people, dialog.item.person_id)} onClose={() => setDialog(null)} onEdit={() => setDialog({ kind: 'visit', item: dialog.item })} />}
    {dialog?.kind === 'prayerHistory' && <PrayerHistory dates={snapshot.checks.filter((item) => item.prayer_id === dialog.item.id).map((item) => item.prayed_on)} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'answer' && <AnswerDialog item={dialog.item} onClose={() => setDialog(null)} onSave={async (note) => { await operate(() => setPrayerStatus(dialog.item, 'answered', note), '已記下蒙應允') }} />}
  </div>
  {focusOpen && <FocusPrayer groups={focusGroups} index={focusIndex} checkedToday={checkedToday} busy={focusBusy} onClose={() => setFocusOpen(false)} onPrevious={() => setFocusIndex((index) => (index - 1 + focusGroups.length) % focusGroups.length)} onNext={() => setFocusIndex((index) => (index + 1) % focusGroups.length)} onComplete={(prayers) => void completePerson(prayers)} />}
  <PrintSheet groups={prayerGroups} label={status === 'active' ? '持續代禱' : '蒙應允'} date={today} />
  </>
}

function EmptyState({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return <div className="empty-state"><HeartHandshake size={32} /><h2>{text}</h2><button className="button-quiet" onClick={onClick}><Plus size={17} /> {action}</button></div>
}

function AnswerDialog({ item, onClose, onSave }: { item: PrayerItem; onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const [note, setNote] = useState(item.answered_note)
  const [busy, setBusy] = useState(false)
  return <Modal title="記錄蒙應允" onClose={onClose}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await onSave(note) } finally { setBusy(false) } }}><p className="muted">這件事如何蒙應允？也可以稍後再補記。</p><label className="field"><span>回望與見證</span><textarea rows={5} autoFocus value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="form-actions"><button type="button" className="button-quiet" onClick={onClose}>取消</button><button className="button-primary" disabled={busy}>記下蒙應允</button></div></form></Modal>
}
