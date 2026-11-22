import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Link, useNavigate } from 'react-router-dom';
import PasswordInput from '../components/PasswordInput.jsx';
import { adminAuthService } from '../services/api.js';

const inputClass = 'w-full border border-xora-taupe/40 bg-white px-3.5 py-2.5 text-base leading-5 sm:text-sm focus:outline-none focus:border-xora-charcoal';

export default function AdminSecurityPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState('proof');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [currentRecoveryCode, setCurrentRecoveryCode] = useState('');
  const [replacementCode, setReplacementCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [setup, setSetup] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrError, setQrError] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setQrDataUrl('');
    setQrError('');
    if (!setup?.otpauthUrl) return () => { active = false; };
    QRCode.toDataURL(setup.otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
      color: { dark: '#201B17', light: '#FFFFFF' }
    }).then((dataUrl) => {
      if (active) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (active) setQrError('The QR code could not be displayed. You can use the private setup key below.');
    });
    return () => { active = false; };
  }, [setup?.otpauthUrl]);

  const beginReplacement = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        currentPassword,
        ...(useRecoveryCode ? { recoveryCode: currentRecoveryCode } : { code: currentCode })
      };
      const { data } = await adminAuthService.beginMfaReplacement(payload);
      setChallengeId(data.challengeId);
      setSetup({ secret: data.secret, otpauthUrl: data.otpauthUrl, expiresAt: data.expiresAt });
      setCurrentPassword('');
      setCurrentCode('');
      setCurrentRecoveryCode('');
      setStage('verify');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'YAQANA could not verify your current password and authenticator.');
    } finally {
      setLoading(false);
    }
  };

  const verifyReplacement = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await adminAuthService.verifyMfaReplacement({ challengeId, code: replacementCode });
      setRecoveryCodes(data.recoveryCodes || []);
      setSetup(null);
      setStage('recovery');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'The new authenticator code could not be verified. Your existing authenticator remains active.');
    } finally {
      setLoading(false);
    }
  };

  const startOver = () => {
    setStage('proof');
    setChallengeId('');
    setSetup(null);
    setReplacementCode('');
    setError('');
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center bg-xora-cream px-4 py-10 sm:px-6">
      <section className="w-full max-w-xl border border-xora-taupe/30 bg-xora-offwhite p-6 sm:p-8" aria-labelledby="admin-security-title">
        <span className="text-[11px] uppercase tracking-luxury text-xora-taupe-dark">YAQANA administration</span>
        <h1 id="admin-security-title" className="mt-2 font-serif text-3xl text-xora-charcoal">
          {stage === 'proof' ? 'Change Authenticator' : stage === 'verify' ? 'Set Up Replacement Authenticator' : 'Save New Recovery Codes'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-xora-taupe-dark">
          {stage === 'proof' && 'Your current authenticator stays active until a code from the replacement has been verified.'}
          {stage === 'verify' && 'Scan this QR with Google Authenticator, then enter the six-digit code it displays. The QR is generated in this browser.'}
          {stage === 'recovery' && 'Your replacement is active. These new recovery codes are shown once; save them privately before continuing.'}
        </p>

        {error && <div className="mt-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}

        {stage === 'proof' && (
          <form className="mt-6 space-y-4" onSubmit={beginReplacement}>
            <label className="block text-xs font-medium text-xora-charcoal">
              Current password
              <PasswordInput className={`${inputClass} mt-1`} name="currentPassword" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            </label>
            {!useRecoveryCode ? (
              <label className="block text-xs font-medium text-xora-charcoal">
                Current six-digit authenticator code
                <input className={`${inputClass} mt-1`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={currentCode} onChange={(event) => setCurrentCode(event.target.value.replace(/\D/gu, '').slice(0, 6))} />
              </label>
            ) : (
              <label className="block text-xs font-medium text-xora-charcoal">
                One unused recovery code
                <input className={`${inputClass} mt-1`} autoComplete="off" required value={currentRecoveryCode} onChange={(event) => setCurrentRecoveryCode(event.target.value)} />
              </label>
            )}
            <button className="text-xs underline underline-offset-4" type="button" onClick={() => setUseRecoveryCode((value) => !value)}>
              {useRecoveryCode ? 'Use current authenticator instead' : 'Use one recovery code instead'}
            </button>
            <button className="btn-luxury w-full py-3.5 text-[10px] disabled:opacity-60" type="submit" disabled={loading}>
              {loading ? 'Verifying current factor…' : 'Verify and show replacement QR'}
            </button>
            <p className="text-xs leading-5 text-xora-taupe-dark">A recovery code is consumed as soon as it is accepted. The current authenticator remains active if you cancel or the replacement fails.</p>
          </form>
        )}

        {stage === 'verify' && setup && (
          <form className="mt-6 space-y-4" onSubmit={verifyReplacement}>
            <div className="space-y-4 border border-xora-taupe/30 bg-white p-4 text-xs text-xora-charcoal">
              <ol className="list-decimal space-y-2 pl-5" aria-label="Google Authenticator replacement steps">
                <li>Open Google Authenticator on your phone.</li>
                <li>Tap <strong>+</strong>, then choose <strong>Scan a QR code</strong>.</li>
                <li>Scan the replacement QR shown here.</li>
                <li>Enter the new six-digit code below before this setup expires.</li>
              </ol>
              {qrDataUrl ? (
                <img className="mx-auto h-60 w-60 max-w-full border border-xora-taupe/20 p-2" src={qrDataUrl} alt="Scan replacement QR code with Google Authenticator" />
              ) : (
                <p role={qrError ? 'alert' : 'status'}>{qrError || 'Preparing your private QR code…'}</p>
              )}
              <details>
                <summary className="cursor-pointer underline underline-offset-2">Can’t scan? Show the private setup key</summary>
                <p className="mt-2">This long-term key is private. Enter it only in Google Authenticator; it is not the six-digit code.</p>
                <code className="mt-2 block break-all rounded bg-xora-cream p-3 select-all">{setup.secret}</code>
              </details>
            </div>
            <label className="block text-xs font-medium text-xora-charcoal">
              New six-digit code from Google Authenticator
              <input className={`${inputClass} mt-1`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={replacementCode} onChange={(event) => setReplacementCode(event.target.value.replace(/\D/gu, '').slice(0, 6))} />
            </label>
            <button className="btn-luxury w-full py-3.5 text-[10px] disabled:opacity-60" type="submit" disabled={loading}>
              {loading ? 'Checking replacement code…' : 'Verify replacement and activate'}
            </button>
            <button className="w-full py-2 text-xs text-xora-taupe-dark underline underline-offset-4" type="button" disabled={loading} onClick={startOver}>Cancel and keep current authenticator</button>
            <p className="text-xs text-xora-taupe-dark">This QR expires in five minutes. Your current authenticator continues to work until verification succeeds.</p>
          </form>
        )}

        {stage === 'recovery' && (
          <div className="mt-6 space-y-4">
            <ul className="grid grid-cols-1 gap-2 rounded border border-xora-taupe/30 bg-white p-4 font-mono text-xs sm:grid-cols-2" aria-label="New one-time recovery codes">
              {recoveryCodes.map((code) => <li key={code} className="break-all">{code}</li>)}
            </ul>
            <button className="btn-luxury w-full py-3.5 text-[10px]" type="button" onClick={() => navigate('/admin', { replace: true })}>I saved the codes — return to Admin</button>
          </div>
        )}

        {stage !== 'recovery' && <Link className="mt-5 block text-center text-xs text-xora-taupe-dark underline underline-offset-4" to="/admin">Return to Admin dashboard</Link>}
      </section>
    </div>
  );
}
