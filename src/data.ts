import { createClient } from '@supabase/supabase-js'
import type { CarePerson, CareVisit, PersonDraft, PrayerItem, PrayerStatus, Snapshot, VisitDraft } from './types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const isDemo = !url || !key
export const supabase = isDemo ? null : createClient(url, key)

const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const demoPerson: CarePerson = {
  id: id(), name: '林以恩', category: '朋友', is_profiled: true,
  birthday: null, residence: '台中', feeling: '最近開始願意分享生活中的難處。',
  photo_path: null, created_at: now(),
}
let demo: Snapshot = {
  people: [demoPerson, { ...demoPerson, id: id(), name: '眾教會', category: '群體', is_profiled: false, residence: '', feeling: '' }],
  prayers: [
    { id: id(), person_id: demoPerson.id, request: '為新的工作環境禱告，求主賜下平安與合宜的同行者。', status: 'active', is_pinned: true, answered_at: null, answered_note: '', source_visit_id: null, created_at: now() },
  ],
  visits: [
    { id: id(), person_id: demoPerson.id, visit_date: new Date().toLocaleDateString('en-CA'), place: '咖啡店', family_note: '與家人的關係漸漸穩定。', work_note: '正在適應新工作。', spiritual_note: '願意重新開始讀經。', prayer_note: '', created_at: now() },
  ],
}

function requireClient() {
  if (!supabase) throw new Error('尚未設定雲端資料庫')
  return supabase
}

async function userId() {
  const { data, error } = await requireClient().auth.getUser()
  if (error || !data.user) throw new Error('登入已失效，請重新登入')
  return data.user.id
}

function mustSucceed(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

export async function loadSnapshot(): Promise<Snapshot> {
  if (isDemo) return structuredClone(demo)
  const client = requireClient()
  const [peopleResult, prayerResult, visitResult] = await Promise.all([
    client.from('care_people').select('*').order('name'),
    client.from('prayer_items').select('*').order('created_at', { ascending: false }),
    client.from('care_visits').select('*').order('visit_date', { ascending: false }),
  ])
  mustSucceed(peopleResult.error)
  mustSucceed(prayerResult.error)
  mustSucceed(visitResult.error)
  const people = (peopleResult.data ?? []) as CarePerson[]
  await Promise.all(people.map(async (person) => {
    if (!person.photo_path) return
    const { data } = await client.storage.from('person-photos').download(person.photo_path)
    person.photo_url = data ? URL.createObjectURL(data) : null
  }))
  return { people, prayers: (prayerResult.data ?? []) as PrayerItem[], visits: (visitResult.data ?? []) as CareVisit[] }
}

export async function savePerson(draft: PersonDraft, existing?: CarePerson, photo?: File | null, removePhoto = false) {
  const clean = { ...draft, name: draft.name.trim(), category: draft.category.trim(), residence: draft.residence.trim(), feeling: draft.feeling.trim() }
  if (!clean.name) throw new Error('請輸入姓名或群體名稱')
  if (photo && (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || photo.size > 5 * 1024 * 1024)) {
    throw new Error('照片僅接受 JPG、PNG、WebP，且不得超過 5 MB')
  }
  if (photo && removePhoto) throw new Error('請選擇上傳或移除照片')
  if (isDemo) {
    if (demo.people.some((person) => person.id !== existing?.id && person.name.trim().toLocaleLowerCase() === clean.name.toLocaleLowerCase())) {
      throw new Error('這個姓名已經建檔，請直接編輯原檔案')
    }
    const next = { ...clean, id: existing?.id ?? id(), photo_path: removePhoto ? null : existing?.photo_path ?? null, photo_url: removePhoto ? null : photo ? URL.createObjectURL(photo) : existing?.photo_url, created_at: existing?.created_at ?? now() }
    demo.people = existing ? demo.people.map((item) => item.id === existing.id ? next : item) : [...demo.people, next]
    return
  }
  const client = requireClient()
  const owner_id = await userId()
  const personId = existing?.id ?? id()
  const { error } = await client.from('care_people').upsert({ ...clean, id: personId, owner_id, updated_at: now() })
  mustSucceed(error)
  if (removePhoto && existing?.photo_path) {
    mustSucceed((await client.storage.from('person-photos').remove([existing.photo_path])).error)
    mustSucceed((await client.from('care_people').update({ photo_path: null, updated_at: now() }).eq('id', personId)).error)
  }
  if (photo) {
    const path = existing?.photo_path ?? `${owner_id}/${personId}/photo`
    const upload = await client.storage.from('person-photos').upload(path, photo, { contentType: photo.type, upsert: Boolean(existing?.photo_path) })
    mustSucceed(upload.error)
    if (!existing?.photo_path) {
      const update = await client.from('care_people').update({ photo_path: path, updated_at: now() }).eq('id', personId)
      if (update.error) {
        const cleanup = await client.storage.from('person-photos').remove([path])
        throw new Error(cleanup.error ? `${update.error.message}；新照片清理失敗：${cleanup.error.message}` : update.error.message)
      }
    }
  }
}

export async function deletePerson(person: CarePerson) {
  if (isDemo) {
    demo.people = demo.people.filter((item) => item.id !== person.id)
    demo.prayers = demo.prayers.filter((item) => item.person_id !== person.id)
    demo.visits = demo.visits.filter((item) => item.person_id !== person.id)
    return
  }
  const client = requireClient()
  if (person.photo_path) mustSucceed((await client.storage.from('person-photos').remove([person.photo_path])).error)
  const result = await client.from('care_people').delete().eq('id', person.id)
  mustSucceed(result.error)
}

export async function savePrayer(personId: string, request: string, existing?: PrayerItem) {
  const clean = request.trim()
  if (!clean) throw new Error('請輸入代禱內容')
  if (isDemo) {
    if (existing) demo.prayers = demo.prayers.map((item) => item.id === existing.id ? { ...item, person_id: personId, request: clean } : item)
    else demo.prayers.unshift({ id: id(), person_id: personId, request: clean, status: 'active', is_pinned: false, answered_at: null, answered_note: '', source_visit_id: null, created_at: now() })
    return
  }
  const client = requireClient()
  const result = existing
    ? await client.from('prayer_items').update({ person_id: personId, request: clean, updated_at: now() }).eq('id', existing.id)
    : await client.from('prayer_items').insert({ owner_id: await userId(), person_id: personId, request: clean })
  mustSucceed(result.error)
}

export async function setPrayerStatus(prayer: PrayerItem, status: PrayerStatus, answeredNote = '') {
  if (isDemo) {
    demo.prayers = demo.prayers.map((item) => item.id === prayer.id ? { ...item, status, answered_at: status === 'answered' ? now() : null, answered_note: status === 'answered' ? answeredNote : '' } : item)
    return
  }
  mustSucceed((await requireClient().from('prayer_items').update({ status, answered_at: status === 'answered' ? now() : null, answered_note: status === 'answered' ? answeredNote : '', updated_at: now() }).eq('id', prayer.id)).error)
}

export async function setPrayerPinned(prayer: PrayerItem, isPinned: boolean) {
  if (isDemo) {
    demo.prayers = demo.prayers.map((item) => item.id === prayer.id ? { ...item, is_pinned: isPinned } : item)
    return
  }
  mustSucceed((await requireClient().from('prayer_items').update({ is_pinned: isPinned, updated_at: now() }).eq('id', prayer.id)).error)
}

export async function deletePrayer(prayer: PrayerItem) {
  if (isDemo) {
    demo.prayers = demo.prayers.filter((item) => item.id !== prayer.id)
    return
  }
  mustSucceed((await requireClient().from('prayer_items').delete().eq('id', prayer.id)).error)
}

export async function saveVisit(draft: VisitDraft, existing?: CareVisit) {
  if (!draft.person_id || !draft.visit_date) throw new Error('請選擇代禱者和訪談日期')
  if (isDemo) {
    const next = { ...draft, id: existing?.id ?? id(), created_at: existing?.created_at ?? now() }
    demo.visits = existing ? demo.visits.map((item) => item.id === existing.id ? next : item) : [next, ...demo.visits]
    const linked = demo.prayers.find((item) => item.source_visit_id === next.id)
    if (existing && draft.prayer_note.trim() === existing.prayer_note.trim() && draft.person_id === existing.person_id) return
    if (draft.prayer_note.trim()) {
      if (linked && linked.status !== 'answered' && linked.request === existing?.prayer_note.trim()) {
        linked.request = draft.prayer_note.trim()
        linked.person_id = next.person_id
      } else {
        if (linked) linked.source_visit_id = null
        demo.prayers.unshift({ id: id(), person_id: next.person_id, request: draft.prayer_note.trim(), status: 'active', is_pinned: false, answered_at: null, answered_note: '', source_visit_id: next.id, created_at: now() })
      }
    } else if (linked) linked.source_visit_id = null
    return
  }
  const client = requireClient()
  const row = { ...draft, owner_id: await userId(), updated_at: now() }
  const result = existing
    ? await client.from('care_visits').update(row).eq('id', existing.id)
    : await client.from('care_visits').insert(row)
  mustSucceed(result.error)
}

export async function deleteVisit(visit: CareVisit) {
  if (isDemo) {
    demo.visits = demo.visits.filter((item) => item.id !== visit.id)
    demo.prayers = demo.prayers.map((item) => item.source_visit_id === visit.id ? { ...item, source_visit_id: null } : item)
    return
  }
  mustSucceed((await requireClient().from('care_visits').delete().eq('id', visit.id)).error)
}
