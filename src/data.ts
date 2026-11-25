import { createClient } from '@supabase/supabase-js'
import { splitPrayerLines } from './prayerLines'
import type { CarePerson, CareVisit, PersonDraft, PrayerCheck, PrayerItem, PrayerStatus, Snapshot, VisitDraft } from './types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const isDemo = !url || !key
export const supabase = isDemo ? null : createClient(url, key)

const photoCache = new Map<string, { url?: string; pending?: Promise<string | null> }>()
const photoInvalidations = new Map<string, number>()
let photoOwner: string | null = null
let photoGeneration = 0

export function setPhotoOwner(owner: string | null) {
  if (owner === photoOwner) return
  photoOwner = owner
  photoGeneration++
  for (const entry of photoCache.values()) if (entry.url) URL.revokeObjectURL(entry.url)
  photoCache.clear()
  photoInvalidations.clear()
}

export function cachedPhotoUrl(path: string | null): string | null {
  return path ? photoCache.get(path)?.url ?? null : null
}

export async function loadPersonPhoto(path: string): Promise<string | null> {
  const cached = photoCache.get(path)
  if (cached?.url) return cached.url
  if (cached?.pending) return cached.pending
  const generation = photoGeneration
  const invalidation = photoInvalidations.get(path) ?? 0
  const pending = (async () => {
    try {
      const { data, error } = await requireClient().storage.from('person-photos').download(path)
      if (error || !data) throw error ?? new Error('照片下載失敗')
      const objectUrl = URL.createObjectURL(data)
      if (generation !== photoGeneration || invalidation !== (photoInvalidations.get(path) ?? 0)) { URL.revokeObjectURL(objectUrl); return null }
      photoCache.set(path, { url: objectUrl })
      return objectUrl
    } catch {
      if (generation === photoGeneration && invalidation === (photoInvalidations.get(path) ?? 0)) photoCache.delete(path)
      return null
    }
  })()
  photoCache.set(path, { pending })
  return pending
}

function invalidatePhoto(path: string) {
  photoInvalidations.set(path, (photoInvalidations.get(path) ?? 0) + 1)
  const cached = photoCache.get(path)
  if (cached?.url) URL.revokeObjectURL(cached.url)
  photoCache.delete(path)
}

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
    { id: id(), person_id: demoPerson.id, request: '為新的工作環境禱告，求主賜下平安與合宜的同行者。', status: 'active', is_pinned: true, answered_at: null, answered_note: '', source_visit_id: null, source_visit_line: null, created_at: now() },
  ],
  visits: [
    { id: id(), person_id: demoPerson.id, visit_date: new Date().toLocaleDateString('en-CA'), place: '咖啡店', family_note: '與家人的關係漸漸穩定。', work_note: '正在適應新工作。', spiritual_note: '願意重新開始讀經。', prayer_note: '', synced_prayer: '', created_at: now() },
  ],
  checks: [],
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
  const fetchAll = async (table: 'care_people' | 'prayer_items' | 'care_visits', order: string, ascending: boolean) => {
    const rows: Record<string, unknown>[] = []
    for (let offset = 0; ; offset += 500) {
      const result = await client.from(table).select('*').order(order, { ascending }).order('id').range(offset, offset + 499)
      mustSucceed(result.error)
      rows.push(...(result.data ?? []))
      if ((result.data?.length ?? 0) < 500) break
    }
    return rows
  }
  const [people, prayers, visits] = await Promise.all([
    fetchAll('care_people', 'name', true),
    fetchAll('prayer_items', 'created_at', false),
    fetchAll('care_visits', 'visit_date', false),
  ])
  const checks: PrayerCheck[] = []
  for (let offset = 0; ; offset += 500) {
    const result = await client.from('prayer_checks').select('id,prayer_id,prayed_on,created_at').order('prayed_on', { ascending: false }).order('id').range(offset, offset + 499)
    mustSucceed(result.error)
    checks.push(...(result.data ?? []))
    if ((result.data?.length ?? 0) < 500) break
  }
  return { people: people as CarePerson[], prayers: prayers as PrayerItem[], visits: visits as CareVisit[], checks }
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
    invalidatePhoto(existing.photo_path)
  }
  if (photo) {
    const path = existing?.photo_path ?? `${owner_id}/${personId}/photo`
    const upload = await client.storage.from('person-photos').upload(path, photo, { contentType: photo.type, upsert: Boolean(existing?.photo_path) })
    mustSucceed(upload.error)
    invalidatePhoto(path)
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
    const removed = new Set(demo.prayers.filter((item) => item.person_id === person.id).map((item) => item.id))
    demo.checks = demo.checks.filter((item) => !removed.has(item.prayer_id))
    demo.prayers = demo.prayers.filter((item) => item.person_id !== person.id)
    demo.visits = demo.visits.filter((item) => item.person_id !== person.id)
    return
  }
  const client = requireClient()
  if (person.photo_path) {
    mustSucceed((await client.storage.from('person-photos').remove([person.photo_path])).error)
    invalidatePhoto(person.photo_path)
  }
  const result = await client.from('care_people').delete().eq('id', person.id)
  mustSucceed(result.error)
}

export async function savePrayer(personId: string, request: string, existing?: PrayerItem) {
  const clean = request.trim()
  if (!clean) throw new Error('請輸入代禱內容')
  if (isDemo) {
    if (existing) demo.prayers = demo.prayers.map((item) => item.id === existing.id ? { ...item, person_id: personId, request: clean } : item)
    else demo.prayers.unshift({ id: id(), person_id: personId, request: clean, status: 'active', is_pinned: false, answered_at: null, answered_note: '', source_visit_id: null, source_visit_line: null, created_at: now() })
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

export async function setPrayerChecked(prayer: PrayerItem, prayedOn: string, checked: boolean) {
  if (isDemo) {
    if (checked) demo.checks = demo.checks.filter((item) => !(item.prayer_id === prayer.id && item.prayed_on === prayedOn))
    else if (!demo.checks.some((item) => item.prayer_id === prayer.id && item.prayed_on === prayedOn)) {
      demo.checks.unshift({ id: id(), prayer_id: prayer.id, prayed_on: prayedOn, created_at: now() })
    }
    return
  }
  const client = requireClient()
  if (checked) {
    mustSucceed((await client.from('prayer_checks').delete().eq('prayer_id', prayer.id).eq('prayed_on', prayedOn)).error)
  } else {
    const { error } = await client.from('prayer_checks').insert({ owner_id: await userId(), prayer_id: prayer.id, prayed_on: prayedOn })
    if (error && error.code !== '23505') mustSucceed(error)
  }
}

export async function markPrayersChecked(prayers: PrayerItem[], prayedOn: string) {
  if (!prayers.length) return
  if (isDemo) {
    for (const prayer of prayers) {
      if (!demo.checks.some((item) => item.prayer_id === prayer.id && item.prayed_on === prayedOn)) {
        demo.checks.unshift({ id: id(), prayer_id: prayer.id, prayed_on: prayedOn, created_at: now() })
      }
    }
    return
  }
  const owner_id = await userId()
  const rows = prayers.map((prayer) => ({ owner_id, prayer_id: prayer.id, prayed_on: prayedOn }))
  mustSucceed((await requireClient().from('prayer_checks').upsert(rows, {
    onConflict: 'owner_id,prayer_id,prayed_on', ignoreDuplicates: true,
  })).error)
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
    demo.checks = demo.checks.filter((item) => item.prayer_id !== prayer.id)
    return
  }
  mustSucceed((await requireClient().from('prayer_items').delete().eq('id', prayer.id)).error)
}

export async function saveVisit(draft: VisitDraft, existing?: CareVisit) {
  if (!draft.person_id || !draft.visit_date) throw new Error('請選擇代禱者和訪談日期')
  if (isDemo) {
    const previous = demo.visits.find((item) => item.id === existing?.id)
    const next = { ...draft, id: existing?.id ?? id(), synced_prayer: draft.prayer_note.trim(), created_at: existing?.created_at ?? now() }
    demo.visits = existing ? demo.visits.map((item) => item.id === existing.id ? next : item) : [next, ...demo.visits]
    if (previous && next.synced_prayer === previous.synced_prayer && next.person_id === previous.person_id) return
    const oldLines = splitPrayerLines(previous?.synced_prayer ?? '')
    const linked = demo.prayers.filter((item) => item.source_visit_id === next.id)
    const candidates = linked.filter((item) => {
      const line = item.source_visit_line ?? 1
      return item.status !== 'answered' && (item.request === oldLines[line - 1] || (line === 1 && item.request === previous?.synced_prayer))
    })
    demo.prayers = demo.prayers.map((item) => item.source_visit_id === next.id ? { ...item, source_visit_id: null, source_visit_line: null } : item)
    for (const [index, request] of splitPrayerLines(next.prayer_note).entries()) {
      const line = index + 1
      const matched = candidates.find((item) => item.request === request) ?? candidates.find((item) => item.source_visit_line === line)
      if (matched) {
        demo.prayers = demo.prayers.map((item) => item.id === matched.id ? { ...item, person_id: next.person_id, request, source_visit_id: next.id, source_visit_line: line } : item)
        candidates.splice(candidates.indexOf(matched), 1)
      } else {
        demo.prayers.unshift({ id: id(), person_id: next.person_id, request, status: 'active', is_pinned: false, answered_at: null, answered_note: '', source_visit_id: next.id, source_visit_line: line, created_at: now() })
      }
    }
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
    demo.prayers = demo.prayers.map((item) => item.source_visit_id === visit.id ? { ...item, source_visit_id: null, source_visit_line: null } : item)
    return
  }
  mustSucceed((await requireClient().from('care_visits').delete().eq('id', visit.id)).error)
}
