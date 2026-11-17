import { useEffect, useState } from 'react'
import { activeOrganizers, errorText, organizerStatus, pendingOrganizers, reviewOrganizer, revokeOrganizer, type OrganizerRequest, type OrganizerStatus } from '../data/client.ts'
import { Notice } from './common.tsx'

export function useOrganizerAccess(userId?: string) {
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ userId: string; retry: number; status?: OrganizerStatus; failure?: string }>()
  useEffect(() => {
    if (!userId) return
    let current = true
    organizerStatus().then(
      status => { if (current) setResult({ userId, retry, status }) },
      error => { if (current) setResult({ userId, retry, failure: errorText(error) }) },
    )
    return () => { current = false }
  }, [userId, retry])
  return {
    result: userId && result?.userId === userId && result.retry === retry ? result : undefined,
    refresh: () => setRetry(value => value + 1),
  }
}

export function OrganizerRequests() {
  const [requests, setRequests] = useState<OrganizerRequest[]>()
  const [active, setActive] = useState<OrganizerRequest[]>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [message, setMessage] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let current = true
    pendingOrganizers().then(
      items => { if (current) setRequests(items) },
      error => { if (current) setFailure(errorText(error)) },
    )
    activeOrganizers().then(
      items => { if (current) setActive(items) },
      error => { if (current) setFailure(errorText(error)) },
    )
    return () => { current = false }
  }, [refresh])

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusy(true)
    setFailure('')
    setMessage('')
    try {
      await reviewOrganizer(id, decision)
      setRequests(items => items?.filter(item => item.id !== id))
      if (decision === 'approved') setRefresh(value => value + 1)
      setMessage(decision === 'approved' ? 'Konto freigegeben.' : 'Antrag abgelehnt.')
    } catch (error) {
      setFailure(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(account: OrganizerRequest) {
    if (!window.confirm(`Verwaltungszugang für ${account.email} entziehen?`)) return
    setBusy(true)
    setFailure('')
    setMessage('')
    try {
      await revokeOrganizer(account.id)
      setActive(items => items?.filter(item => item.id !== account.id))
      setMessage('Verwaltungszugang entzogen.')
    } catch (error) {
      setFailure(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return <section className="card">
    <div className="card-heading"><h2>Kontoanträge</h2>
      <button className="button secondary" disabled={busy} onClick={() => {
        setRequests(undefined); setFailure(''); setMessage(''); setRefresh(value => value + 1)
      }}>Anträge aktualisieren</button>
    </div>
    <div className="card-body form-stack">
      {failure && <Notice>{failure}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {!requests && !failure && <p>Anträge werden geladen …</p>}
      {requests?.length === 0 && <p>Keine offenen Kontoanträge.</p>}
      {requests?.map(request => <div className="form-box" key={request.id}>
        <strong>{request.email}</strong>
        <div className="button-row">
          <button className="button primary" disabled={busy} onClick={() => void decide(request.id, 'approved')}>Freigeben</button>
          <button className="button secondary" disabled={busy} onClick={() => void decide(request.id, 'rejected')}>Ablehnen</button>
        </div>
      </div>)}
      <h3>Freigegebene Organisatoren</h3>
      {active?.length === 0 && <p>Keine weiteren Organisatoren freigegeben.</p>}
      {active?.map(account => <div className="form-box" key={account.id}>
        <strong>{account.email}</strong>
        <div><button className="button secondary" disabled={busy} onClick={() => void revoke(account)}>Zugang entziehen</button></div>
      </div>)}
    </div>
  </section>
}
