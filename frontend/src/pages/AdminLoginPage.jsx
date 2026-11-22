import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PasswordInput from '../components/PasswordInput.jsx';
import { adminAuthService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const inputClass = 'w-full border border-xora-taupe/40 bg-white px-3.5 py-2.5 text-base leading-5 sm:text-sm focus:outline-none focus:border-xora-charcoal';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, loading: authLoading, completeAdminLogin } = useAuth();
  const redirect = new URLSearchParams(location.search).get('redirect');
  const [stage, setStage] = useState('credentials');
  const [form, setForm] = useState({ email: '', password: '', code: '', recoveryCode: '' });
  const [challengeToken, setChallengeToken] = useState('');
  const [setup, setSetup] = useState(null);
  const [setupQr, setSetupQr] = useState('');
  const [setupQrError, setSetupQrError] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && isAdmin && user?.adminMfaVerified && stage === 'credentials') {
      navigate(redirect || '/admin', { replace: true });
    }
  }, [authLoading, isAdmin, user, stage, navigate, redirect]);

  useEffect(() => {
    let current = true;
    setSetupQr('');
    setSetupQrError('');
    if (!setup?.otpauthUrl) return () => { current = false; };
    QRCode.toDataURL(setup.otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
      color: { dark: '#201B17', light: '#FFFFFF' }
    }).then((dataUrl) => {
      if (current) setSetupQr(dataUrl);
    }).catch(() => {
      if (current) setSetupQrError('The QR code could not be displayed. Use the private setup key below.');
    });
    return () => { current = false; };
  }, [setup?.otpauthUrl]);

  const startLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await adminAuthService.beginLogin({ email: form.email, password: form.password });
      const result = response.data;
      setChallengeToken(result.challengeToken);
      if (result.status === 'mfa_setup_required') {
        setSetup({ secret: result.secret, otpauthUrl: result.otpauthUrl });
        setStage('verify');
      } else if (result.status === 'mfa_required') {
        setSetup(null);
        setStage('verify');
      } else {
        setError('The administrator sign-in response was not recognized.');
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to begin administrator sign-in.');
    } finally {
      setLoading(false);
    }
  };

  const verifyMfa = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    const result = await completeAdminLogin({
      challengeToken,
      code: useRecovery ? undefined : form.code,
      recoveryCode: useRecovery ? form.recoveryCode : undefined
    });
    if (!result.success) {
      setError(result.message || 'Unable to verify administrator sign-in.');
      setLoading(false);
      return;
    }
    if (Array.isArray(result.recoveryCodes) && result.recoveryCodes.length) {
      setRecoveryCodes(result.recoveryCodes);
      setStage('recovery');
      setLoading(false);
      return;
    }
    navigate(['admin', 'owner'].includes(result.user?.role) ? (redirect || '/admin') : '/account', { replace: true });
  };

  const goToDestination = () => navigate(isAdmin ? (redirect || '/admin') : '/account', { replace: true });

  return (
    <div className="flex min-h-[80vh] items-center justify-center bg-xora-cream px-4 py-12 sm:px-6">
      <div className="w-full max-w-md">
        <section className="border border-xora-taupe/30 bg-xora-offwhite p-6 sm:p-8" aria-labelledby="admin-login-title">
          <span className="text-[11px] uppercase tracking-luxury text-xora-taupe-dark">YAQANA administration</span>
          <h1 id="admin-login-title" className="mt-2 font-serif text-3xl text-xora-charcoal">
            {stage === 'credentials' ? 'Administrator Sign In' : stage === 'recovery' ? 'Save Recovery Codes' : setup ? 'Set Up Authenticator' : 'Verify Your Sign In'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-xora-taupe-dark">
            {stage === 'credentials' && 'Use your staff account. Customer sign-in and registration do not grant administrative access.'}
            {stage === 'verify' && setup && 'Follow the steps below to connect Google Authenticator. The backend turns MFA on only after it verifies the app’s six-digit code.'}
            {stage === 'verify' && !setup && 'Enter a current authenticator code, or use one unused recovery code.'}
            {stage === 'recovery' && 'These recovery codes are shown once. Store them somewhere private before continuing.'}
          </p>

          {error && <div className="mt-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}

          {stage === 'credentials' && (
            <form className="mt-6 space-y-4" onSubmit={startLogin}>
              <label className="block text-xs font-medium text-xora-charcoal">
                Email
                <input className={`${inputClass} mt-1`} type="email" autoComplete="username" required value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
              </label>
              <label className="block text-xs font-medium text-xora-charcoal">
                Password
                <PasswordInput className={`${inputClass} mt-1`} name="password" autoComplete="current-password" required value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
              </label>
              <button className="btn-luxury w-full py-3.5 text-[10px] disabled:opacity-60" type="submit" disabled={loading || authLoading}>{loading ? 'Checking credentials…' : 'Continue securely'}</button>
            </form>
          )}

          {stage === 'verify' && (
            <form className="mt-6 space-y-4" onSubmit={verifyMfa}>
              {setup && (
                <div className="space-y-4 border border-xora-taupe/30 bg-white p-4 text-xs text-xora-charcoal">
                  <ol className="list-decimal space-y-2 pl-5" aria-label="Google Authenticator setup steps">
                    <li>Install Google Authenticator on your Android phone or iPhone.</li>
                    <li>Open Google Authenticator.</li>
                    <li>Tap the <strong>+</strong> button.</li>
                    <li>Select <strong>Scan a QR code</strong>.</li>
                    <li>Scan the QR code shown here.</li>
                    <li>The app will show a six-digit code that changes about every 30 seconds.</li>
                    <li>Enter that six-digit code into YAQANA below. YAQANA enables MFA after the backend verifies it.</li>
                  </ol>
                  {setupQr ? (
                    <img className="mx-auto h-60 w-60 max-w-full border border-xora-taupe/20 p-2" src={setupQr} alt="Scan this QR code with Google Authenticator" />
                  ) : (
                    <p role={setupQrError ? 'alert' : 'status'}>{setupQrError || 'Preparing your private QR code…'}</p>
                  )}
                  <details>
                    <summary className="cursor-pointer underline underline-offset-2">Can’t scan? Show the private setup key</summary>
                    <p className="mt-2">This setup key is a long-term secret. Keep it private. It is different from the temporary six-digit code.</p>
                    <code className="mt-2 block break-all rounded bg-xora-cream p-3 select-all">{setup.secret}</code>
                  </details>
                </div>
              )}
              {!useRecovery ? (
                <label className="block text-xs font-medium text-xora-charcoal">
                  Six-digit code from Google Authenticator
                  <input className={`${inputClass} mt-1`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.replace(/\D/gu, '').slice(0, 6) }))} />
                  <span className="mt-1 block font-normal text-xora-taupe-dark">Enter the temporary six-digit code from your phone, not the private setup key.</span>
                </label>
              ) : (
                <label className="block text-xs font-medium text-xora-charcoal">
                  Unused recovery code
                  <input className={`${inputClass} mt-1`} autoComplete="off" required value={form.recoveryCode} onChange={(event) => setForm((current) => ({ ...current, recoveryCode: event.target.value }))} />
                </label>
              )}
              {!setup && <button className="text-xs underline underline-offset-4" type="button" onClick={() => setUseRecovery((value) => !value)}>{useRecovery ? 'Use authenticator instead' : 'Use a recovery code'}</button>}
              <button className="btn-luxury w-full py-3.5 text-[10px] disabled:opacity-60" type="submit" disabled={loading}>{loading ? 'Verifying…' : setup ? 'Enable MFA and sign in' : 'Verify and sign in'}</button>
              <button className="w-full py-2 text-xs text-xora-taupe-dark underline underline-offset-4" type="button" disabled={loading} onClick={() => { setStage('credentials'); setSetup(null); setChallengeToken(''); setForm((current) => ({ ...current, password: '', code: '', recoveryCode: '' })); }}>Start over</button>
            </form>
          )}

          {stage === 'recovery' && (
            <div className="mt-6 space-y-4">
              <ul className="grid grid-cols-1 gap-2 rounded border border-xora-taupe/30 bg-white p-4 font-mono text-xs sm:grid-cols-2" aria-label="One-time recovery codes">
                {recoveryCodes.map((code) => <li key={code} className="break-all">{code}</li>)}
              </ul>
              <button className="btn-luxury w-full py-3.5 text-[10px]" type="button" onClick={goToDestination}>I saved these codes — continue</button>
            </div>
          )}

          <div className="mt-6 border-t border-xora-taupe/20 pt-4 text-xs text-xora-taupe-dark">
            Customer account? <Link className="font-medium text-xora-charcoal underline underline-offset-4" to="/login">Use customer sign-in</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
