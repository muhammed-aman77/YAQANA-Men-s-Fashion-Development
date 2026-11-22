import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { supportService } from '../services/api.js';
import { buildSupportTicketPayload } from '../utils/supportCenter.js';

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', message: '', category: 'Orders' });
  const { isAuthenticated, user } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isAuthenticated) return;
    setSubmitting(true);
    try {
      const payload = buildSupportTicketPayload({
        name: form.name || user?.name,
        email: form.email || user?.email,
        message: form.message,
        category: form.category
      });
      await supportService.createTicket(payload);
      setSubmitted(true);
    } catch (submissionError) {
      setError(submissionError.response?.data?.message || submissionError.message || 'Unable to send your message.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateForm = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  return (
    <div className="bg-xora-cream min-h-screen py-12 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <span className="text-[11px] uppercase tracking-luxury text-xora-taupe-dark">Customer care</span>
            <h1 className="font-serif text-4xl sm:text-5xl mt-2">We’re here to help.</h1>
            <p className="mt-4 text-sm text-xora-taupe-dark leading-relaxed">
              Whether you need styling support, order updates, or garment care guidance, our concierge team is ready to assist.
            </p>

            <div className="mt-8 space-y-4 text-sm text-xora-charcoal">
              <div className="flex items-center space-x-3">
                <Mail className="w-4 h-4 text-xora-charcoal" />
                <a href="mailto:apparelyaqana@gmail.com" className="hover:text-xora-taupe-dark transition-colors">
                  apparelyaqana@gmail.com
                </a>
              </div>
              <div className="flex items-center space-x-3">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 text-xora-charcoal" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="0.75" fill="currentColor" stroke="none" />
                </svg>
                <a
                  href="https://www.instagram.com/yaqana_apparel/"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-xora-taupe-dark transition-colors"
                >
                  @yaqana_apparel
                </a>
              </div>
            </div>
          </div>

          <div className="bg-xora-offwhite border border-xora-taupe/30 p-6 sm:p-8 rounded-xs">
            {submitted ? (
              <div className="text-center py-10">
                <h2 className="font-serif text-3xl text-xora-charcoal">Message sent.</h2>
                <p className="mt-3 text-sm text-xora-taupe-dark">
                  Your support request was saved and is available in your account.
                </p>
              </div>
            ) : !isAuthenticated ? (
              <div className="text-center py-10">
                <h2 className="font-serif text-3xl text-xora-charcoal">Sign in to contact support.</h2>
                <p className="mt-3 text-sm text-xora-taupe-dark">
                  You can also email apparelyaqana@gmail.com or contact @yaqana_apparel on Instagram.
                </p>
                <Link to="/login?redirect=/contact" className="btn-luxury inline-flex mt-6 px-6 py-3 text-[10px]">
                  Sign In
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                    {error}
                  </div>
                )}
                <div>
                  <label className="block text-[11px] uppercase tracking-luxury font-medium text-xora-charcoal mb-1">Name</label>
                  <input type="text" required value={form.name || user?.name || ''} onChange={updateForm('name')} className="w-full border border-xora-taupe/40 bg-white px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal" />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-luxury font-medium text-xora-charcoal mb-1">Email</label>
                  <input type="email" required value={form.email || user?.email || ''} onChange={updateForm('email')} className="w-full border border-xora-taupe/40 bg-white px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal" />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-luxury font-medium text-xora-charcoal mb-1">Topic</label>
                  <select value={form.category} onChange={updateForm('category')} className="w-full border border-xora-taupe/40 bg-white px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal">
                    {['Orders', 'Delivery', 'Cancellations', 'Returns', 'Exchanges', 'Refunds', 'Payments', 'Products', 'Account'].map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-luxury font-medium text-xora-charcoal mb-1">Message</label>
                  <textarea rows="5" required value={form.message} onChange={updateForm('message')} className="w-full border border-xora-taupe/40 bg-white px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal resize-none" />
                </div>
                <button type="submit" disabled={submitting} className="btn-luxury w-full py-3 text-[10px] disabled:opacity-60">
                  {submitting ? 'Sending...' : 'Send Message'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
