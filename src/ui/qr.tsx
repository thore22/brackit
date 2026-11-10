import { useEffect, useState } from 'react'
import { Download, ExternalLink, LockKeyhole, Printer, QrCode, Radio } from 'lucide-react'
import QRCode from 'qrcode'
import { activateCourt, connected, errorText, issueRef, listCourtStations } from '../data/client.ts'
import type { CourtActivation, CourtStation, Invitation, Tournament } from '../data/types.ts'
import { clock, type Match } from '../engine/model.ts'
import { courtName, courtPath, gameOf, Heading, Notice, ordered, publicPath, teamName } from './common.tsx'

type QR = { href: string; data: string; title: string; subtitle: string; invitation?: Pick<Invitation, 'pin' | 'expires'>; protected?: boolean }
const imageOf = (href: string) => QRCode.toDataURL(href, { width: 480, margin: 4, errorCorrectionLevel: 'M' })
export default function QRPage({ tournament, offline }: { tournament: Tournament; offline: boolean }) {
  const [spectator, setSpectator] = useState<QR | null>(null)
  const [issued, setIssued] = useState<Record<string, QR>>({})
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const available = ordered(tournament.plan.matches).filter(match => ['scheduled','running'].includes(gameOf(tournament, match.id).status))
  useEffect(() => {
    if (tournament.state === 'draft') return
    let current = true
    const href = new URL(publicPath(tournament.id), location.origin).href
    imageOf(href).then(data => { if (current) setSpectator({ href, data, title: 'Live-Ansicht', subtitle: 'Spielplan, Ergebnisse und Tabellen' }) },
      error => { if (current) setError(errorText(error)) })
    return () => { current = false }
  }, [tournament.id, tournament.state])
  async function create(match: Match) {
    setBusy(match.court); setError('')
    try {
      const invitation = await issueRef(tournament.id, match.id)
      const url = new URL(publicPath(tournament.id, 'report'), location.origin)
      url.search = new URLSearchParams({ field: match.court, slot: String(match.slot), game: String(match.id), token: invitation.token }).toString()
      const href = url.href
      const data = await imageOf(href)
      setIssued(values => ({ ...values, [match.court]: { data, href, invitation, title: courtName(tournament, match.court), subtitle: `Schiedsgericht · Slot ${match.slot} · Spiel ${match.id} · ${clock(match.start)} Uhr` } }))
    } catch (failure) { setError(errorText(failure)) }
    finally { setBusy('') }
  }
  return <>
    <Heading eyebrow="Verwaltung" title="QR-Codes" subtitle="Teile die Live-Ansicht und richte QR-Codes für die Spielfelder ein."
      actions={<button className="button secondary no-print" disabled={!spectator} onClick={() => window.print()}><Printer size={17}/>Aushang drucken</button>}/>
    {tournament.state === 'draft' && <Notice tone="info">Veröffentliche das Turnier, um QR-Codes zu erzeugen.</Notice>}
    {!connected && <div className="no-print"><Notice tone="info">Lokaler Modus. Geräteübergreifende QR-Zugänge benötigen die bereitgestellte App mit Supabase.</Notice></div>}
    {error && <Notice>{error}</Notice>}
    {tournament.state === 'published' && <CourtQRSection key={tournament.id} tournament={tournament} offline={offline}/>}
    {tournament.state === 'published' && <h2 className="no-print">Live-Ansicht und Zugänge für einzelne Spiele</h2>}
    <div className="qr-grid">
      {spectator && <QRCard qr={spectator} event={tournament.config.name}/>}
      {tournament.state === 'published' && tournament.config.courts.map(court => {
        const matches = available.filter(match => match.court === court.id)
        const match = matches.find(item => item.id === selected[court.id]) ?? matches[0]
        const qr = issued[court.id]
        return <div className="qr-column" key={court.id}>
          <section className="card no-print"><div className="card-heading"><div><h2><LockKeyhole size={19}/> {court.name}</h2><p>Zeitlich begrenzter Zugang pro Spiel</p></div></div>
            <div className="card-body form-stack"><label>Spiel und Slot<select value={match?.id ?? ''} onChange={event => setSelected(items => ({ ...items, [court.id]: +event.target.value }))}>
              {!matches.length && <option value="">Keine geplanten Spiele</option>}{matches.map(match => <option key={match.id} value={match.id}>Slot {match.slot} · Spiel {match.id} · {teamName(tournament, match.a)} – {teamName(tournament, match.b)}</option>)}</select></label>
              <button className="button primary fit" disabled={!!busy || !match || offline} onClick={() => match && void create(match)}><QrCode size={17}/>QR-Zugang erzeugen</button>
              <p className="hint">Ein neuer Zugang widerruft frühere Zugänge desselben Spiels. Die PIN wird einmal angezeigt und separat weitergegeben.</p>
            </div>
          </section>
          {qr && <QRCard qr={qr} event={tournament.config.name}/>}
        </div>
      })}
    </div>
  </>
}
function CourtQRSection({ tournament, offline }: { tournament: Tournament; offline: boolean }) {
  const [stations, setStations] = useState<CourtStation[] | null>(null)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [pins, setPins] = useState<Record<string, CourtActivation>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    if (!offline) listCourtStations(tournament.id).then(value => { if (current) { setStations(value); setError('') } },
      failure => { if (current) setError(errorText(failure)) })
    return () => { current = false }
  }, [tournament.id, offline])
  async function activate(field: string, name: string, existing?: CourtStation) {
    setBusy(true); setError('')
    try {
      const activation = await activateCourt(tournament.id, field, existing)
      setPins(previous => ({ ...previous, [activation.id]: activation }))
      setStations(previous => [...(previous ?? []).filter(station => station.id !== activation.id), {
        id: activation.id, name: existing?.name ?? name,
        assignment: { tournamentId: tournament.id, field }, tournamentName: tournament.config.name, expires: activation.expires,
      }])
    } catch (failure) {
      setError(errorText(failure))
      await listCourtStations(tournament.id).then(setStations, () => {})
    }
    finally { setBusy(false) }
  }
  return <>
    <div className="no-print"><h2>Dauerhafte Feld-QR-Codes</h2><p className="hint">Der Aushang öffnet das laufende Spiel. Gib die Feld-PIN separat weiter. Sie gilt 12 Stunden und schaltet jeweils nur das laufende Spiel frei.</p></div>
    {error && <Notice>{error}</Notice>}
    <div className="qr-grid">
      {tournament.config.courts.map(court => {
        const station = stations?.find(station => station.assignment?.tournamentId === tournament.id && station.assignment.field === court.id)
        const reusable = stations?.filter(station => station.assignment?.tournamentId !== tournament.id) ?? []
        const choice = reusable.find(station => station.id === selected[court.id])
        return <div className="court-qr-column form-stack" key={court.id}>
          <section className="card no-print">
            <div className="card-heading"><div><h2><QrCode size={19}/> {court.name}</h2><p>Dauerhafter Zugang für dieses Feld</p></div></div>
            <div className="card-body form-stack">
              {!station && reusable.length > 0 && <label>Feld-QR auswählen<select value={choice?.id ?? ''} onChange={event => setSelected(values => ({ ...values, [court.id]: event.target.value }))}>
                <option value="">Neuen Feld-QR anlegen</option>
                {reusable.map(station => <option key={station.id} value={station.id}>{station.name} · {station.tournamentName ?? 'Ohne Turnier'}</option>)}
              </select></label>}
              {choice && !station && <p className="hint">Die Zuordnung zu {choice.tournamentName ?? 'einem früheren Turnier'} wird ersetzt. Der gedruckte QR-Code bleibt gültig.</p>}
              {station && <p className="hint">Eine neue PIN widerruft alle bestehenden Freigaben über diesen Feld-QR.</p>}
              <button className="button primary fit" disabled={busy || offline || !stations} onClick={() => void activate(court.id, court.name, station ?? choice)}>
                <LockKeyhole size={17}/>{station ? 'Feld-PIN erneuern' : choice ? 'Feld-QR zuordnen' : 'Feld-QR anlegen'}
              </button>
            </div>
          </section>
          {station && <StationQR key={station.id} station={station} name={court.name} pin={pins[station.id]?.expires === station.expires ? pins[station.id] : undefined} onFailure={setError}/>}
        </div>
      })}
    </div>
  </>
}
function StationQR({ station, name, pin, onFailure }: { station: CourtStation; name: string; pin?: CourtActivation; onFailure: (error: string) => void }) {
  const [data, setData] = useState('')
  const href = new URL(courtPath(station.id), location.origin).href
  useEffect(() => {
    let current = true
    imageOf(href).then(image => { if (current) setData(image) }, failure => { if (current) onFailure(errorText(failure)) })
    return () => { current = false }
  }, [href, onFailure])
  return data ? <QRCard qr={{ data, href, title: name, subtitle: 'Laufendes Spiel · Feld-PIN bei der Turnierleitung', protected: true, invitation: pin }} event="Dauerhafter Feld-QR"/> : null
}
function QRCard({ qr, event }: { qr: QR; event: string }) {
  return <section className="card qr-card">
    <div className="qr-top"><span className="section-icon">{qr.protected || qr.invitation ? <LockKeyhole size={21}/> : <Radio size={21}/>}</span><p className="eyebrow">{event}</p><h2>{qr.title}</h2><p>{qr.subtitle}</p></div>
    <img className="qr-image" src={qr.data} alt={`QR-Code für ${qr.title}`} width={230} height={230}/>
    <p className="print-only">Mit der Smartphone-Kamera scannen.{(qr.protected || qr.invitation) && ' PIN bei der Turnierleitung erfragen.'}</p>
    {qr.invitation && <div className="qr-pin no-print"><small>{qr.protected ? 'Feld-PIN' : 'Schiedsrichter-PIN'}</small><strong>{qr.invitation.pin}</strong><span>Gültig bis {new Date(qr.invitation.expires).toLocaleString('de-DE')}</span></div>}
    <div className="button-row no-print">
      <a className="button secondary" download={`qr-${qr.title.toLowerCase().replaceAll(' ', '-')}.png`} href={qr.data}><Download size={16}/>PNG</a>
      <a className="button secondary" href={qr.href} target="_blank" rel="noreferrer"><ExternalLink size={16}/>Öffnen</a>
    </div>
  </section>
}
