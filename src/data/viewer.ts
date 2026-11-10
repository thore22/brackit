const lastLiveKey = 'turnierleitung.viewer.last-live'
const teamKey = (id: string) => `turnierleitung.viewer.team.${id}`

function read(key: string) {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}

function save(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch { /* Preferences are optional when browser storage is unavailable. */ }
}

export const lastLiveTournament = () => read(lastLiveKey)
export const rememberLiveTournament = (id: string) => save(lastLiveKey, id)
export const savedTeam = (id: string) => read(teamKey(id))
export const rememberTeam = (id: string, team: string) => save(teamKey(id), team)
