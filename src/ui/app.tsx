import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Bell, CalendarRange, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck, Download, LayoutDashboard, LogIn, LogOut, Menu, Monitor, Moon, Plus, QrCode, Radio, Settings2, Sun, Trophy, Volleyball, X } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from 'react-router'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { connected, errorText, incompleteSetup, latestCachedTournament, listTournaments, supabase } from '../data/client.ts'
import { demoId } from '../data/local.ts'
import type { Tournament, TournamentSummary } from '../data/types.ts'
import { Dashboard, ResultsPage, SettingsPage } from './admin.tsx'
import { adminPath, Badge, Brand, dateLabel, Empty, Heading, Notice, progress, publicPath, useTournament } from './common.tsx'
import { GamePanel } from './game-panel.tsx'
import { LivePage, PublicHeader, ReportPage, TVPage } from './public.tsx'
import { QRPage } from './qr.tsx'
import { SchedulePage, StandingsPage } from './schedule.tsx'
import { Wizard } from './wizard.tsx'

const sections = [
  { label: 'Übersicht', icon: LayoutDashboard, path: '' },
  { label: 'Spielplan', icon: CalendarRange, path: '/spielplan' },
  { label: 'Tabellen', icon: Trophy, path: '/tabellen' },
  { label: 'Ergebnisse', icon: ClipboardCheck, path: '/ergebnisse' },
]
const settings = [
  { label: 'Turniereinstellungen', icon: Settings2, path: '/einstellungen' },
  { label: 'QR-Codes', icon: QrCode, path: '/qr' },
]
function useAuth() {
  const [session, setSession] = useState<Session | null | undefined>(connected ? undefined : null)
  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])
  return session
}

export function App() {
  const session = useAuth()
  const signedIn = !!session && !session.user.is_anonymous
  const location = useLocation()
  const { needRefresh: [update], updateServiceWorker } = useRegisterSW()
  const [dark, setDark] = useState(() => localStorage.getItem('turnierleitung.theme') === 'dark' ||
    (!localStorage.getItem('turnierleitung.theme') && matchMedia('(prefers-color-scheme: dark)').matches))
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])
  const theme = { dark, toggle: () => {
    localStorage.setItem('turnierleitung.theme', dark ? 'light' : 'dark')
    setDark(!dark)
  } }
  const workspace = (child: ReactNode) => <Shell theme={theme} session={session}>{child}</Shell>
  const guard = (child: ReactNode) => connected && !signedIn
    ? session === undefined ? workspace(<Loading/>) : workspace(<Login/>) : child
  const cached = connected && !navigator.onLine ? latestCachedTournament() : null
  return <>
    <a className="skip-link" href="#inhalt">Zum Inhalt</a>
    <Routes>
      <Route path="/" element={<Navigate to={cached ? publicPath(cached.id) : connected ? '/turniere' : adminPath(demoId)} replace/>}/>
      <Route path="/turniere" element={guard(workspace(<TournamentList/>))}/>
      <Route path="/neu" element={guard(workspace(<Wizard/>))}/>
      <Route path="/admin/:id/*" element={guard(<AdminRoute theme={theme} session={session}/>)}/>
      <Route path="/t/:id/:screen" element={<PublicRoute/>}/>
      <Route path="*" element={workspace(<Empty title="Seite nicht gefunden" description="Öffne die Turnierverwaltung über das Menü."/>)}/>
    </Routes>
    {update && <div className="pwa-update"><span>Eine neue App-Version ist verfügbar.</span><button className="button primary" onClick={() => void updateServiceWorker(true)}>Aktualisieren</button></div>}
  </>
}

type Theme = { dark: boolean; toggle: () => void }
function Shell({ tournament, session, theme, children }: { tournament?: Tournament; session?: Session | null; theme: Theme; children: ReactNode }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [help, setHelp] = useState(false)
  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); setHelp(false) } }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  const pending = tournament ? progress(tournament).pending : 0
  const base = tournament ? adminPath(tournament.id) : ''
  return <div className="app-shell">
    {open && <button className="nav-overlay" aria-label="Menü schließen" onClick={() => setOpen(false)}/>}
    <aside className={`sidebar ${open ? 'open' : ''}`} id="hauptnavigation">
      <div className="sidebar-brand"><Brand/><button className="icon-button minimal mobile-only" aria-label="Menü schließen" onClick={() => setOpen(false)}><X size={20}/></button></div>
      <Link className="tournament-switch" to="/turniere">
        <span className="switch-icon"><Volleyball size={18}/></span><span><small>TURNIER</small><strong>{tournament?.config.name ?? 'Meine Turniere'}</strong></span><ChevronDown size={15}/>
      </Link>
      <nav aria-label="Hauptnavigation" className="sidebar-nav">
        {tournament ? <>
          <p>TURNIERBETRIEB</p>
          {sections.map(({ label, icon: Icon, path }) => <NavLink key={label} to={base + path} end={path === ''}><Icon size={19}/><span>{label}</span>{label === 'Ergebnisse' && pending > 0 && <b className="nav-count">{pending}</b>}</NavLink>)}
          <p>VERWALTUNG</p>
          {settings.map(({ label, icon: Icon, path }) => <NavLink key={label} to={base + path}><Icon size={19}/><span>{label}</span></NavLink>)}
          <p>ANZEIGEN</p>
          <Link to={publicPath(tournament.id)}><Radio size={19}/><span>Live-Ansicht</span><ChevronRight size={14}/></Link>
          <Link to={publicPath(tournament.id, 'tv')}><Monitor size={19}/><span>Hallenbildschirm</span><ChevronRight size={14}/></Link>
        </> : <>
          <p>VERWALTUNG</p>
          <NavLink to="/turniere"><LayoutDashboard size={19}/><span>Meine Turniere</span></NavLink>
          <NavLink to="/neu"><Plus size={19}/><span>Neues Turnier</span></NavLink>
        </>}
      </nav>
      <div className="sidebar-bottom">
        <button onClick={() => setHelp(!help)}><CircleHelp size={18}/><span>Hilfe & Installation</span></button>
        <div className="sidebar-profile"><span className="avatar">{session?.user.email?.slice(0, 2).toUpperCase() ?? 'TL'}</span><div><strong>Turnierleitung</strong><small>{session?.user.email ?? (connected ? 'Administrationsbereich' : 'Lokaler Arbeitsplatz')}</small></div>
          {session && !session.user.is_anonymous && <button className="icon-button minimal" aria-label="Abmelden" onClick={() => void supabase?.auth.signOut()}><LogOut size={16}/></button>}
        </div>
      </div>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <div className="top-left"><button className="icon-button mobile-only" aria-label="Menü öffnen" aria-expanded={open} aria-controls="hauptnavigation" onClick={() => setOpen(!open)}><Menu size={21}/></button>
          <span className="breadcrumb"><Link to="/turniere">Turniere</Link><ChevronRight size={14}/><strong>{tournament?.config.name ?? 'Verwaltung'}</strong></span></div>
        <div className="top-right">
          {!connected && <Badge tone="green">Lokal</Badge>}
          <button className="icon-button" aria-label={theme.dark ? 'Hellmodus aktivieren' : 'Dunkelmodus aktivieren'} title={theme.dark ? 'Hellmodus' : 'Dunkelmodus'} onClick={theme.toggle}>{theme.dark ? <Sun size={19}/> : <Moon size={18}/>}</button>
          {tournament && <Link className="icon-button notification" to={`${base}/ergebnisse`} aria-label={pending ? `${pending} ausstehende Ergebnisse` : 'Ergebnisse öffnen'}><Bell size={18}/>{pending > 0 && <i/>}</Link>}
          <Link className="button secondary top-new" to="/neu"><Plus size={17}/>Neues Turnier</Link>
        </div>
      </header>
      <main id="inhalt" className="page-content">
        {incompleteSetup && <Notice>Supabase ist unvollständig konfiguriert. Für die Verbindung werden Projekt-URL und Publishable Key benötigt.</Notice>}
        {children}
      </main>
    </div>
    {help && <InstallHelp close={() => setHelp(false)}/>}
  </div>
}
function InstallHelp({ close }: { close: () => void }) {
  const [prompt, setPrompt] = useState(installPrompt)
  useEffect(() => {
    const sync = () => setPrompt(installPrompt)
    window.addEventListener('turnierleitung.install', sync)
    return () => window.removeEventListener('turnierleitung.install', sync)
  }, [])
  return <div className="modal-backdrop" onClick={close}><section role="dialog" aria-modal="true" aria-labelledby="install-title" className="card install-dialog" onClick={event => event.stopPropagation()}>
    <div className="card-heading"><h2 id="install-title">App installieren</h2><button className="icon-button minimal" autoFocus aria-label="Schließen" onClick={close}><X size={20}/></button></div>
    <div className="card-body form-stack">
      <p>Auf iPhone oder iPad öffnest du in Safari das Teilen-Menü und wählst „Zum Home-Bildschirm“.</p>
      <p>Auf Android und Desktop findest du „App installieren“ im Browsermenü, wenn die App über HTTPS oder localhost geöffnet ist.</p>
      {prompt && <button className="button primary fit" onClick={async () => { await prompt.prompt(); installPrompt = null; setPrompt(null) }}><Download size={17}/>Jetzt installieren</button>}
      {!connected && <Notice tone="info">Lokaler Modus. Die Daten bleiben in diesem Browser. Für den Mehrgerätebetrieb wird eine Supabase-Verbindung benötigt.</Notice>}
    </div>
  </section></div>
}
type InstallEvent = Event & { prompt(): Promise<unknown> }
let installPrompt: InstallEvent | null = null
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  installPrompt = event as InstallEvent
  window.dispatchEvent(new Event('turnierleitung.install'))
})
window.addEventListener('appinstalled', () => { installPrompt = null })

function AdminRoute({ theme, session }: { theme: Theme; session?: Session | null }) {
  const { id = '' } = useParams()
  const { tournament, failure, offline, linked, offset, refresh } = useTournament(id, true)
  const shell = (body: ReactNode) => <Shell theme={theme} session={session} tournament={tournament?.admin ? tournament : undefined}>{body}</Shell>
  if (!tournament) return shell(failure || offline ? <Notice>{failure || 'Offline. In diesem Browser ist kein synchronisierter Turnierstand gespeichert.'}</Notice> : <Loading/>)
  if (!tournament.admin && !offline) return shell(<Notice>Dieses Konto hat keine Verwaltungsrechte für das Turnier.</Notice>)
  return shell(<>
    {offline && <Notice tone="offline">Offline – Daten möglicherweise nicht aktuell.</Notice>}
    {connected && !linked && !offline && <Notice tone="info">Echtzeitverbindung wird aufgebaut. Der Turnierstand wird zusätzlich regelmäßig abgefragt.</Notice>}
    {!tournament.admin ? <SchedulePage tournament={tournament}/> : <Routes>
      <Route index element={<Dashboard tournament={tournament} offline={offline} offset={offset} refresh={refresh}/>}/>
      <Route path="spielplan" element={<SchedulePage tournament={tournament} manage/>}/>
      <Route path="tabellen" element={<StandingsPage tournament={tournament} manage/>}/>
      <Route path="ergebnisse" element={<ResultsPage tournament={tournament}/>}/>
      <Route path="einstellungen" element={<SettingsPage tournament={tournament} offline={offline} refresh={refresh}/>}/>
      <Route path="qr" element={<QRPage tournament={tournament} offline={offline}/>}/>
      <Route path="spiel/:game" element={<AdminGame tournament={tournament} offline={offline} offset={offset} refresh={refresh}/>}/>
      <Route path="konfigurieren" element={tournament.state === 'draft' ? <Wizard key={tournament.id} existing={tournament} offline={offline}/> : <Navigate to=".." replace/>}/>
      <Route path="*" element={<Empty title="Ansicht nicht gefunden"/>}/>
    </Routes>}
  </>)
}
function AdminGame(props: { tournament: Tournament; offline: boolean; offset: number; refresh: () => unknown }) {
  const { game } = useParams()
  const match = props.tournament.plan.matches.find(match => match.id === Number(game))
  return match ? <GamePanel key={match.id} {...props} match={match} admin access/> : <Empty title="Spiel nicht gefunden"/>
}
function PublicRoute() {
  const { id = '', screen } = useParams()
  const { tournament, failure, offline, linked, offset, refresh } = useTournament(id, false)
  if (screen === 'tv' && tournament) return <TVPage tournament={tournament} offset={offset} offline={offline}/>
  return <div className="public-shell">
    {tournament ? <PublicHeader tournament={tournament}/> : <header className="public-header"><div><Brand/></div></header>}
    <main id="inhalt" className="public-content">
      {offline && <Notice tone="offline">Offline – Daten möglicherweise nicht aktuell.</Notice>}
      {connected && !linked && !offline && tournament && <Notice tone="info">Echtzeitverbindung wird aufgebaut.</Notice>}
      {!tournament ? failure ? <Notice>{failure}</Notice> : offline ? <Empty title="Kein Turnierstand gespeichert"/> : <Loading/> :
        screen === 'live' ? <LivePage key={id} tournament={tournament} offset={offset}/> :
          screen === 'report' ? <ReportPage key={id} tournament={tournament} offset={offset} offline={offline} refresh={refresh}/> :
            <Empty title="Ansicht nicht gefunden"/>}
    </main>
  </div>
}

function Loading() { return <div className="card"><Empty title="Turnierstand wird geladen …"/></div> }

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  async function login(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setFailure('')
    try {
      const { error } = await supabase!.auth.signInWithPassword({ email, password })
      if (error) throw error
    } catch (error) { setFailure(errorText(error)) }
    finally { setBusy(false) }
  }
  return <>
    <Heading eyebrow="Administration" title="Turnierleitung anmelden" subtitle="Melde dich mit deinem eingerichteten Supabase-Konto an."/>
    <section className="card login-card"><form className="card-body form-stack" onSubmit={login}>
      <label>E-Mail<input autoComplete="username" type="email" required value={email} onChange={event => setEmail(event.target.value)}/></label>
      <label>Passwort<input autoComplete="current-password" type="password" required value={password} onChange={event => setPassword(event.target.value)}/></label>
      {failure && <Notice>{failure}</Notice>}
      <button className="button primary fit" disabled={busy}><LogIn size={17}/>Anmelden</button>
    </form></section>
  </>
}
const names = { draft: 'Entwurf', published: 'Veröffentlicht', archived: 'Archiviert' }
function TournamentList() {
  const [items, setItems] = useState<TournamentSummary[] | null>(null)
  const [failure, setFailure] = useState('')
  useEffect(() => {
    let current = true
    listTournaments().then(result => { if (current) setItems(result) }, error => { if (current) setFailure(errorText(error)) })
    return () => { current = false }
  }, [])
  return <>
    <Heading eyebrow="Verwaltung" title="Meine Turniere" subtitle="Öffne deine Turniere oder lege ein neues Format an."
      actions={<Link className="button primary" to="/neu"><Plus size={18}/>Neues Turnier</Link>}/>
    {!connected && <Notice tone="info">Der lokale Arbeitsplatz speichert Daten in diesem Browser. Verbinde Supabase, um Turniere geräteübergreifend zu betreiben.</Notice>}
    {failure && <Notice>{failure}</Notice>}
    {!items && !failure && <Loading/>}
    {items && <section className="card tournament-list">
      {items.length ? items.map(item => <Link to={adminPath(item.id)} key={item.id} className="tournament-row"><span className="section-icon"><Volleyball size={22}/></span>
        <span><strong>{item.name}</strong><small>{dateLabel(item.date)}</small></span><Badge tone={item.state === 'published' ? 'green' : 'neutral'}>{names[item.state]}</Badge><ArrowRight size={19}/></Link>) :
        <Empty title="Noch kein Turnier angelegt" description="Beginne mit der Volleyballvorlage oder erstelle dein eigenes Format."/>}
    </section>}
  </>
}
