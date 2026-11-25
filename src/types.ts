export type PrayerStatus = 'active' | 'prayed' | 'answered'

export type CarePerson = {
  id: string
  name: string
  category: string
  is_profiled: boolean
  birthday: string | null
  residence: string
  feeling: string
  photo_path: string | null
  photo_url?: string | null
  created_at: string
}

export type PrayerItem = {
  id: string
  person_id: string
  request: string
  status: PrayerStatus
  is_pinned: boolean
  answered_at: string | null
  answered_note: string
  source_visit_id: string | null
  source_visit_line: number | null
  created_at: string
}

export type PrayerCheck = {
  id: string
  prayer_id: string
  prayed_on: string
  created_at: string
}

export type CareVisit = {
  id: string
  person_id: string
  visit_date: string
  place: string
  family_note: string
  work_note: string
  spiritual_note: string
  prayer_note: string
  synced_prayer: string
  created_at: string
}

export type Snapshot = {
  people: CarePerson[]
  prayers: PrayerItem[]
  visits: CareVisit[]
  checks: PrayerCheck[]
}

export type PersonDraft = Pick<CarePerson, 'name' | 'category' | 'is_profiled' | 'birthday' | 'residence' | 'feeling'>
export type VisitDraft = Pick<CareVisit, 'person_id' | 'visit_date' | 'place' | 'family_note' | 'work_note' | 'spiritual_note' | 'prayer_note'>
