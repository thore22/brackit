import { useEffect, useState } from 'react'
import { Download, ExternalLink, LockKeyhole, Printer, QrCode, Radio } from 'lucide-react'
import QRCode from 'qrcode'
import { connected, errorText, issueRef } from '../data/client.ts'
import type { Invitation, Tournament } from '../data/types.ts'
import { clock, type Match } from '../engine/model.ts'
import { courtName, gameOf, Heading, Notice, ordered, publicPath, teamName } from './common.tsx'

type QR = { href: string; data: string; title: string; subtitle: string; invitation?: Invitation }
const imageOf = (href: string) => QRCode.toDataURL(href, { width: 480, margin: 4, errorCorrectionLevel: 'M' })
export function QRPage({ tournament, offline }: { tournament: Tournament; offline: boolean }) {
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
    <Heading eyebrow="Verwaltung" title="QR-Codes" subtitle="Teile die Live-Ansicht und richte Eingabezugänge für einzelne Spiele ein."
      actions={<button className="button secondary no-print" disabled={!spectator} onClick={() => window.print()}><Printer size={17}/>Aushang drucken</button>}/>
    {tournament.state === 'draft' && <Notice tone="info">Veröffentliche das Turnier, um QR-Codes zu erzeugen.</Notice>}
    {!connected && <div className="no-print"><Notice tone="info">Lokaler Modus. Geräteübergreifende QR-Zugänge benötigen die bereitgestellte App mit Supabase.</Notice></div>}
    {error && <Notice>{error}</Notice>}
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
function QRCard({ qr, event }: { qr: QR; event: string }) {
  return <section className="card qr-card">
    <div className="qr-top"><span className="section-icon">{qr.invitation ? <LockKeyhole size={21}/> : <Radio size={21}/>}</span><p className="eyebrow">{event}</p><h2>{qr.title}</h2><p>{qr.subtitle}</p></div>
    <img className="qr-image" src={qr.data} alt={`QR-Code für ${qr.title}`} width={230} height={230}/>
    <p className="print-only">Mit der Smartphone-Kamera scannen.{qr.invitation && ' PIN bei der Turnierleitung erfragen.'}</p>
    {qr.invitation && <div className="qr-pin no-print"><small>Schiedsrichter-PIN</small><strong>{qr.invitation.pin}</strong><span>Gültig bis {new Date(qr.invitation.expires).toLocaleString('de-DE')}</span></div>}
    <div className="button-row no-print">
      <a className="button secondary" download={`qr-${qr.title.toLowerCase().replaceAll(' ', '-')}.png`} href={qr.data}><Download size={16}/>PNG</a>
      <a className="button secondary" href={qr.href} target="_blank" rel="noreferrer"><ExternalLink size={16}/>Öffnen</a>
    </div>
  </section>
}
