import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import PasswordInput from './PasswordInput.jsx';

export default function CheckoutAuthStep({ onAuthenticated }) {
  const { login, register } = useAuth();
  const [authMode, setAuthMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuthentication = async () => {
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email address and password to continue.');
      return;
    }
    if (authMode === 'register' && !name.trim()) {
      setError('Enter your name to create an account.');
      return;
    }
    if (authMode === 'register' && password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = authMode === 'login'
        ? await login(email, password)
        : await register(name, email, password, confirmPassword);
      if (!result.success) {
        setError(result.message || 'Sign in could not be completed. Please try again.');
        return;
      }
      onAuthenticated();
    } catch (authRequestError) {
      setError(authRequestError.message || 'Sign in could not be completed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="bg-xora-offwhite p-6 sm:p-8 border border-xora-taupe/30 rounded-xs space-y-5"
      aria-labelledby="checkout-auth-heading"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          handleAuthentication();
        }
      }}
    >
      <div className="border-b border-xora-taupe/20 pb-3">
        <h2 id="checkout-auth-heading" className="font-serif text-xl text-xora-charcoal tracking-wide">
          Sign in to continue
        </h2>
        <p className="mt-2 text-xs text-xora-taupe-dark">
          Your delivery details and bag are saved while you sign in.
        </p>
      </div>
      {authMode === 'register' && (
        <div>
          <label htmlFor="checkout-account-name" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
            Name
          </label>
          <input
            id="checkout-account-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
          />
        </div>
      )}
      <div>
        <label htmlFor="checkout-account-email" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
          Email address
        </label>
        <input
          id="checkout-account-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
        />
      </div>
      <div>
        <label htmlFor="checkout-account-password" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
          Password
        </label>
        <PasswordInput
          id="checkout-account-password"
          autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
        />
      </div>
      {authMode === 'register' && (
        <div>
          <label htmlFor="checkout-account-confirm-password" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
            Confirm password
          </label>
          <PasswordInput
            id="checkout-account-confirm-password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
          />
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-800">{error}</p>}
      <button
        type="button"
        onClick={handleAuthentication}
        disabled={loading}
        className="btn-luxury w-full py-3 text-xs disabled:opacity-60"
      >
        {loading ? 'PLEASE WAIT...' : authMode === 'login' ? 'SIGN IN AND CONTINUE' : 'CREATE ACCOUNT AND CONTINUE'}
      </button>
      <p className="text-center text-xs text-xora-taupe-dark">
        {authMode === 'login' ? 'New to YAQANA?' : 'Already have an account?'}{' '}
        <button
          type="button"
          onClick={() => {
            setAuthMode(authMode === 'login' ? 'register' : 'login');
            setError('');
          }}
          className="underline underline-offset-2 text-xora-charcoal"
        >
          {authMode === 'login' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </section>
  );
}
