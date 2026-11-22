import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, Smartphone, Banknote, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { orderService, addressService } from '../services/api';
import CheckoutAuthStep from '../components/CheckoutAuthStep.jsx';
import { formatInr } from '../utils/currency';
import { indianStatesAndTerritories } from '../utils/india';
import { getProductImage } from '../utils/productImage';

const paymentOptions = [
  { value: 'Google Pay (UPI)', icon: Smartphone },
  { value: 'PhonePe (UPI)', icon: Smartphone },
  { value: 'Paytm (UPI)', icon: Smartphone },
  { value: 'UPI', icon: Smartphone },
  { value: 'Cash on Delivery', label: 'Cash on Delivery (COD)', icon: Banknote }
];
const CHECKOUT_ATTEMPT_STORAGE_KEY = 'xora_checkout_attempt';

export default function CheckoutPage() {
  const { items, subtotal, shippingFee, estimatedTax, grandTotal, clearCart, loading: cartLoading } = useCart();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [shippingAddress, setShippingAddress] = useState({
    fullName: user?.name || '',
    phone: user?.phone || '',
    email: user?.email || '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'India'
  });
  const checkoutFormRef = useRef(null);

  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [contactChoice, setContactChoice] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('Google Pay (UPI)');
  const [orderNotes, setOrderNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAuthPanel, setShowAuthPanel] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteRefreshKey, setQuoteRefreshKey] = useState(0);
  const [quoteNeedsReview, setQuoteNeedsReview] = useState(false);
  const [retryKeyConflict, setRetryKeyConflict] = useState(false);
  const checkoutAttempt = useRef(null);
  const ignoreStoredAttemptKey = useRef(false);
  const checkoutItems = useMemo(() => items.map((item) => ({
    product: item.productId,
    quantity: item.quantity,
    size: item.size,
    colour: item.colour
  })), [items]);
  const contactDifferences = [
    { label: 'Name', key: 'fullName', checkoutValue: shippingAddress.fullName, accountValue: user?.name },
    { label: 'Email', key: 'email', checkoutValue: shippingAddress.email, accountValue: user?.email },
    { label: 'Phone', key: 'phone', checkoutValue: shippingAddress.phone, accountValue: user?.phone }
  ].filter(({ key, checkoutValue, accountValue }) => {
    if (!String(checkoutValue || '').trim() || !String(accountValue || '').trim()) return false;
    const checkoutContact = String(checkoutValue).trim();
    const accountContact = String(accountValue).trim();
    return key === 'email'
      ? checkoutContact.toLowerCase() !== accountContact.toLowerCase()
      : checkoutContact !== accountContact;
  });

  useEffect(() => {
    if (items.length === 0) {
      navigate('/cart');
    }
  }, [items, navigate]);

  useEffect(() => {
    if (!user) return;
    setShippingAddress((current) => ({
      ...current,
      fullName: current.fullName || user.name || '',
      phone: current.phone || user.phone || '',
      email: current.email || user.email || ''
    }));
  }, [user]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSavedAddresses([]);
      setSelectedAddressId('');
      return;
    }

    let cancelled = false;
    addressService.getAddresses().then((res) => {
      if (cancelled || !res.data.success || !res.data.addresses?.length) return;
      const addresses = res.data.addresses;
      setSavedAddresses(addresses);
    }).catch(() => {
      if (!cancelled) setError('Saved addresses could not be loaded. You can still enter delivery details below.');
    });

    return () => { cancelled = true; };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || cartLoading || !checkoutItems.length) {
      setQuote(null);
      setQuoteLoading(false);
      return undefined;
    }

    let cancelled = false;
    setQuote(null);
    setQuoteError('');
    setQuoteLoading(true);
    orderService.getCheckoutQuote({ items: checkoutItems }).then((res) => {
      if (cancelled) return;
      if (!res.data.success || !res.data.quote || !res.data.quoteToken) {
        setQuoteError('A current order summary could not be confirmed. Please try again.');
        return;
      }
      setQuote({ ...res.data.quote, quoteToken: res.data.quoteToken });
      setQuoteNeedsReview(quoteRefreshKey > 0);
    }).catch((err) => {
      if (!cancelled) setQuoteError(err.response?.data?.message || 'A current order summary could not be confirmed. Please try again.');
    }).finally(() => {
      if (!cancelled) setQuoteLoading(false);
    });

    return () => { cancelled = true; };
  }, [isAuthenticated, cartLoading, checkoutItems, quoteRefreshKey]);

  const handleSavedAddressChange = (addressId) => {
    setSelectedAddressId(addressId);
    setContactChoice(null);
    const addr = savedAddresses.find((a) => a._id === addressId);
    if (addr) {
      setShippingAddress({
        fullName: addr.fullName,
        phone: addr.phone,
        email: shippingAddress.email,
        addressLine1: addr.addressLine1,
        addressLine2: addr.addressLine2 || '',
        city: addr.city,
        state: addr.state,
        postalCode: addr.postalCode,
        country: 'India'
      });
    }
  };

  const handleInputChange = (e) => {
    if (['fullName', 'phone', 'email'].includes(e.target.name)) {
      setContactChoice(null);
    }
    setShippingAddress({
      ...shippingAddress,
      [e.target.name]: e.target.value
    });
  };

  const validateDeliveryDetails = () => {
    const requiredFields = ['fullName', 'email', 'phone', 'addressLine1', 'city', 'state', 'postalCode'];
    const missingField = requiredFields.find((name) => !String(shippingAddress[name] || '').trim());
    if (missingField) {
      setError('Please complete the required delivery details.');
      checkoutFormRef.current?.elements.namedItem(missingField)?.focus();
      return false;
    }

    const emailField = checkoutFormRef.current?.elements.namedItem('email');
    if (emailField && !emailField.checkValidity()) {
      setError('Enter a valid delivery email address.');
      emailField.focus();
      return false;
    }

    if (String(shippingAddress.phone).replace(/\D/g, '').length !== 10) {
      setError('Enter a 10-digit Indian mobile number without a country code.');
      checkoutFormRef.current?.elements.namedItem('phone')?.focus();
      return false;
    }

    const postalCodeField = checkoutFormRef.current?.elements.namedItem('postalCode');
    if (postalCodeField && !postalCodeField.checkValidity()) {
      setError('Enter a valid 6-digit PIN code.');
      postalCodeField.focus();
      return false;
    }

    return true;
  };

  const handleOpenAuth = () => {
    if (!validateDeliveryDetails()) return;
    setError('');
    setShowAuthPanel(true);
  };

  const handleContactChoice = (choice) => {
    if (choice === 'account' && user) {
      setShippingAddress((current) => ({
        ...current,
        fullName: user.name || current.fullName,
        phone: user.phone || current.phone,
        email: user.email || current.email
      }));
    }
    setContactChoice(choice);
    setError('');
  };

  const handleSubmitOrder = async (e) => {
    e.preventDefault();
    setError('');

    if (!isAuthenticated) {
      if (!validateDeliveryDetails()) return;
      setShowAuthPanel(true);
      return;
    }

    if (cartLoading) return;
    if (retryKeyConflict) {
      setError('Start a new checkout attempt before retrying this order.');
      return;
    }
    if (!quote || quoteLoading || quoteNeedsReview) {
      setError(quoteNeedsReview
        ? 'Review the updated order total before placing your order.'
        : 'A current order total is still being confirmed. Please try again shortly.');
      return;
    }

    if (!validateDeliveryDetails()) {
      return;
    }

    if (contactDifferences.length && !contactChoice) {
      setError('Choose which contact details to use before placing your order.');
      return;
    }

    try {
      setLoading(true);

      const orderPayload = {
        items: checkoutItems,
        shippingAddress,
        paymentMethod,
        notes: orderNotes,
        quoteToken: quote.quoteToken
      };

      const signature = JSON.stringify(orderPayload);
      if (checkoutAttempt.current?.signature !== signature) {
        const storedKey = !checkoutAttempt.current && !ignoreStoredAttemptKey.current
          ? sessionStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)
          : null;
        const key = /^[A-Za-z0-9_-]{16,100}$/.test(storedKey || '')
          ? storedKey
          : (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`);
        ignoreStoredAttemptKey.current = false;
        checkoutAttempt.current = { signature, key };
        try {
          sessionStorage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, key);
        } catch {
          console.warn('Checkout retry protection is limited to this page session because session storage is unavailable.');
        }
      }
      const res = await orderService.createOrder(orderPayload, checkoutAttempt.current.key);
      if (res.data.success) {
        checkoutAttempt.current = null;
        try {
          sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
        } catch {
          // The completed order response is authoritative even if storage is unavailable.
        }
        clearCart();
        navigate(`/order-confirmation/${res.data.order._id}`);
      } else {
        throw new Error(res.data.message || 'The order could not be placed. Please try again.');
      }
    } catch (err) {
      console.error('Order creation failed:', err);
      const code = err.response?.data?.code;
      if (code === 'PRICE_OR_AVAILABILITY_CHANGED' || code === 'INVALID_CHECKOUT_QUOTE') {
        setQuote(null);
        setQuoteNeedsReview(true);
        setQuoteRefreshKey((key) => key + 1);
        setError('Prices or availability changed. Refresh and review the new order total before continuing.');
      } else if (code === 'IDEMPOTENCY_KEY_REUSED') {
        checkoutAttempt.current = null;
        ignoreStoredAttemptKey.current = true;
        try {
          sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
        } catch {
          console.warn('A fresh checkout key will be used in memory because session storage is unavailable.');
        }
        setRetryKeyConflict(true);
        setError(err.response?.data?.message || 'This checkout retry key belongs to a different order.');
      } else {
        setError(err.response?.data?.message || 'Failed to place order. Please review information.');
      }
    } finally {
      setLoading(false);
    }
  };

  const displaySubtotal = quote?.subtotal ?? (!isAuthenticated ? subtotal : null);
  const displayShippingFee = quote?.shippingFee ?? (!isAuthenticated ? shippingFee : null);
  const displayTax = quote?.tax ?? (!isAuthenticated ? estimatedTax : null);
  const displayGrandTotal = quote?.total ?? (!isAuthenticated ? grandTotal : null);

  return (
    <div className="bg-xora-cream min-h-screen text-xora-charcoal py-10 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top Header */}
        <div className="mb-8">
          <Link
            to="/cart"
            className="inline-flex items-center text-xs uppercase tracking-luxury text-xora-taupe-dark hover:text-xora-charcoal mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
            <span>Return to Shopping Bag</span>
          </Link>
          <h1 className="font-serif text-3xl sm:text-4xl font-light text-xora-charcoal">
            Secure Checkout
          </h1>
        </div>

        {error && (
          <div role="alert" className="mb-6 p-4 bg-red-50 border border-red-200 text-red-800 rounded-xs flex items-center space-x-3 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form ref={checkoutFormRef} onSubmit={handleSubmitOrder}>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            {/* Form Section (Left 7 Cols) */}
            <div className="lg:col-span-7 space-y-8">
              {/* Account Confirmation */}
              {!isAuthenticated && (
                <div className="bg-xora-sand/50 p-4 border border-xora-taupe/30 rounded-xs flex items-center justify-between text-xs">
                  <div>
                    <span className="font-medium text-xora-charcoal">Have a YAQANA account?</span>
                    <p className="text-xora-taupe-dark">Sign in after entering delivery details to keep your checkout together.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenAuth}
                    className="btn-luxury py-2 px-4 text-[10px] whitespace-nowrap"
                  >
                    SIGN IN
                  </button>
                </div>
              )}

              {/* Saved Addresses (if available) */}
              {isAuthenticated && savedAddresses.length > 0 && (
                <div className="bg-xora-offwhite p-6 border border-xora-taupe/30 rounded-xs space-y-4">
                  <h3 className="text-xs uppercase tracking-luxury font-semibold text-xora-charcoal">
                    Saved Addresses
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {savedAddresses.map((addr) => (
                      <button
                        type="button"
                        key={addr._id}
                        onClick={() => handleSavedAddressChange(addr._id)}
                        aria-pressed={selectedAddressId === addr._id}
                        className={`w-full text-left p-3.5 border rounded-xs cursor-pointer text-xs transition-all ${
                          selectedAddressId === addr._id
                            ? 'border-xora-charcoal bg-white shadow-xs'
                            : 'border-xora-taupe/30 bg-xora-sand/20 hover:border-xora-taupe'
                        }`}
                      >
                        <p className="font-semibold text-xora-charcoal">{addr.fullName}</p>
                        <p className="text-xora-taupe-dark mt-1 line-clamp-1">{addr.addressLine1}</p>
                        <p className="text-xora-taupe-dark">{addr.city}, {addr.state} {addr.postalCode}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Delivery Address Details */}
              <div className="bg-xora-offwhite p-6 sm:p-8 border border-xora-taupe/30 rounded-xs space-y-5">
                <h2 className="font-serif text-xl text-xora-charcoal tracking-wide border-b border-xora-taupe/20 pb-3">
                  1. Shipping Information
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="checkout-fullname" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      name="fullName"
                      value={shippingAddress.fullName}
                      onChange={handleInputChange}
                      required
                      placeholder="e.g. Aarav Sharma"
                      className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
                      id="checkout-fullname"
                    />
                  </div>

                  <div>
                    <label htmlFor="checkout-phone" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
                      Mobile Number *
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      value={shippingAddress.phone}
                      onChange={handleInputChange}
                      required
                      placeholder="98765 43210"
                      className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
                      id="checkout-phone"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor="checkout-email" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      name="email"
                      value={shippingAddress.email}
                      onChange={handleInputChange}
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                      className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
                      id="checkout-email"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor="checkout-address1" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
                      House/Flat No. & Street/Area *
                    </label>
                    <input
                      type="text"
                      name="addressLine1"
                      value={shippingAddress.addressLine1}
                      onChange={handleInputChange}
                      required
                      placeholder="Flat 12, MG Road"
                      className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
                      id="checkout-address1"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor="checkout-address2" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
                      Landmark (Optional)
                    </label>
                    <input
                      type="text"
                      name="addressLine2"
                      value={shippingAddress.addressLine2}
                      onChange={handleInputChange}
                      placeholder="Near Cubbon Park"
                      className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
                      id="checkout-address2"
                    />
                  </div>

                  <div>
                    <label htmlFor="checkout-city" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
                      City *
                    </label>
                    <input
                      type="text"
                      name="city"
                      value={shippingAddress.city}
                      onChange={handleInputChange}
                      required
                      placeholder="Bengaluru"
                      className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
                      id="checkout-city"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="checkout-state" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
                        State *
                      </label>
                      <select
                        name="state"
                        id="checkout-state"
                        value={shippingAddress.state}
                        onChange={handleInputChange}
                        required
                        className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
                      >
                        <option value="">Select State / UT</option>
                        {shippingAddress.state && !indianStatesAndTerritories.includes(shippingAddress.state) && (
                          <option value={shippingAddress.state}>{shippingAddress.state}</option>
                        )}
                        {indianStatesAndTerritories.map((state) => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="checkout-postalcode" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
                        PIN Code *
                      </label>
                      <input
                        type="text"
                        name="postalCode"
                        value={shippingAddress.postalCode}
                        onChange={handleInputChange}
                        required
                        placeholder="560001"
                        inputMode="numeric"
                        maxLength={6}
                        pattern="[0-9]{6}"
                        className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2.5 text-xs focus:outline-none focus:border-xora-charcoal"
                        id="checkout-postalcode"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="checkout-notes" className="block text-xs uppercase tracking-luxury font-medium text-xora-charcoal mb-1">
                    Special Delivery Instructions (Optional)
                  </label>
                  <textarea
                    rows="2"
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    id="checkout-notes"
                    placeholder="Call on arrival or leave with the building reception"
                    className="w-full bg-white border border-xora-taupe/40 px-3.5 py-2 text-xs focus:outline-none focus:border-xora-charcoal resize-none"
                  />
                </div>
              </div>

              {!isAuthenticated && showAuthPanel && (
                <CheckoutAuthStep onAuthenticated={() => setShowAuthPanel(false)} />
              )}

              {isAuthenticated && contactDifferences.length > 0 && (
                <div className="bg-xora-sand/50 p-4 border border-xora-taupe/30 rounded-xs space-y-3" role="group" aria-labelledby="checkout-contact-choice-heading">
                  <div>
                    <h2 id="checkout-contact-choice-heading" className="text-xs font-semibold text-xora-charcoal">
                      Contact details differ from your account
                    </h2>
                    <p className="text-xs text-xora-taupe-dark mt-1">
                      Choose which contact details to use for this delivery.
                    </p>
                  </div>
                  <ul className="space-y-1 text-xs text-xora-taupe-dark">
                    {contactDifferences.map(({ label, checkoutValue, accountValue }) => (
                      <li key={label}>{label}: {checkoutValue} · Account: {accountValue}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-pressed={contactChoice === 'checkout'}
                      onClick={() => handleContactChoice('checkout')}
                      className="border border-xora-taupe/50 px-3 py-2 text-xs text-xora-charcoal hover:border-xora-charcoal"
                    >
                      Keep checkout details
                    </button>
                    <button
                      type="button"
                      aria-pressed={contactChoice === 'account'}
                      onClick={() => handleContactChoice('account')}
                      className="border border-xora-taupe/50 px-3 py-2 text-xs text-xora-charcoal hover:border-xora-charcoal"
                    >
                      Use account details
                    </button>
                  </div>
                  {contactChoice === 'checkout' && (
                    <p role="status" className="text-xs text-xora-taupe-dark">Your checkout contact details will be used.</p>
                  )}
                </div>
              )}

              {isAuthenticated && quote && (
              <div className="bg-xora-offwhite p-6 sm:p-8 border border-xora-taupe/30 rounded-xs space-y-5">
                <div className="border-b border-xora-taupe/20 pb-3 flex items-center justify-between">
                  <h2 className="font-serif text-xl text-xora-charcoal tracking-wide">
                    2. Payment Method
                  </h2>
                  <span className="text-[11px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded font-mono">
                    Sandbox / Test Mode
                  </span>
                </div>

                <fieldset className="space-y-3">
                  <legend className="sr-only">Payment method</legend>
                  {paymentOptions.map(({ value, label, icon: PaymentIcon }) => (
                    <label key={value} className={`block border p-4 rounded-xs cursor-pointer transition-all ${
                      paymentMethod === value
                        ? 'border-xora-charcoal bg-white shadow-xs'
                        : 'border-xora-taupe/30 bg-xora-sand/20'
                    }`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center space-x-3">
                          <input
                            type="radio"
                            name="payment"
                            value={value}
                            aria-label={label || value}
                            checked={paymentMethod === value}
                            onChange={() => setPaymentMethod(value)}
                            className="accent-xora-charcoal w-4 h-4"
                          />
                          <PaymentIcon className="w-4 h-4 text-xora-charcoal flex-shrink-0" />
                          <span className="text-xs font-semibold text-xora-charcoal">
                            {label || value}
                          </span>
                        </div>
                        <span className="text-[10px] uppercase font-mono tracking-wider text-xora-taupe-dark">
                          {value === 'Cash on Delivery' ? 'Pay on delivery' : 'Test mode'}
                        </span>
                      </div>
                    </label>
                  ))}
                </fieldset>
                <p className="text-[10px] text-xora-taupe-dark italic">
                  Mock checkout only. UPI payments are not processed and no payment gateway is connected; this records an order for testing.
                </p>
              </div>
              )}
            </div>

            {/* Order Summary & Confirmation Button (Right 5 Cols) */}
            <div className="lg:col-span-5">
              <div className="bg-xora-offwhite p-6 sm:p-8 rounded-xs border border-xora-taupe/30 space-y-6 shadow-xs lg:sticky lg:top-28 self-start">
                <h2 className="font-serif text-xl text-xora-charcoal tracking-wide border-b border-xora-taupe/20 pb-4">
                  Bag Overview ({items.reduce((s, i) => s + i.quantity, 0)})
                </h2>

                {/* Items preview list */}
                <div className="max-h-60 overflow-y-auto divide-y divide-xora-taupe/20 pr-1">
                  {items.map((item, index) => (
                    <div key={item._id} className="py-3 flex space-x-3 items-center">
                      <img
                        src={item.image || getProductImage({ category: item.category })}
                        alt=""
                        className="w-12 h-16 object-cover rounded-xs bg-xora-sand flex-shrink-0"
                        onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = getProductImage({ category: item.category }); }}
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-serif text-xs text-xora-charcoal truncate">{item.name}</h4>
                        <p className="text-[10px] text-xora-taupe-dark">
                          Qty: {item.quantity} • Size: {item.size} • {item.colour}
                        </p>
                        {quote?.lines[index]?.availableStock != null && (
                          <p className="text-[10px] text-xora-taupe-dark">
                            Available stock: {quote.lines[index].availableStock}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        {quote?.lines[index]?.originalPrice > quote?.lines[index]?.price && (
                          <span className="text-[10px] text-xora-taupe-dark line-through">
                            <span className="sr-only">Original price </span>
                            {formatInr(quote.lines[index].originalPrice * item.quantity)}
                          </span>
                        )}
                        <span className="text-xs font-semibold text-xora-charcoal">
                          {formatInr((quote?.lines[index]?.price ?? item.price) * item.quantity)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Cost breakdown */}
                <div className="space-y-2 pt-2 border-t border-xora-taupe/20 text-xs">
                  <div className="flex justify-between text-xora-taupe-dark">
                    <span>Subtotal</span>
                    <span className="font-medium text-xora-charcoal">{displaySubtotal == null ? 'Confirming…' : formatInr(displaySubtotal)}</span>
                  </div>
                  {quote?.discount > 0 && (
                    <div className="flex justify-between text-xora-taupe-dark">
                      <span>Product discounts</span>
                      <span className="font-medium text-xora-charcoal">−{formatInr(quote.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xora-taupe-dark">
                    <span>Express Shipping</span>
                    <span>{displayShippingFee == null ? 'Confirming…' : displayShippingFee === 0 ? 'Complimentary' : formatInr(displayShippingFee)}</span>
                  </div>
                  <div className="flex justify-between text-xora-taupe-dark">
                    <span>Estimated Tax</span>
                    <span className="font-medium text-xora-charcoal">{displayTax == null ? 'Confirming…' : formatInr(displayTax)}</span>
                  </div>
                  <div className="flex justify-between items-baseline text-base font-semibold text-xora-charcoal pt-3 border-t border-xora-taupe/20">
                    <span>Grand Total</span>
                    <span className="text-xl">{displayGrandTotal == null ? 'Confirming…' : formatInr(displayGrandTotal)}</span>
                  </div>
                </div>

                {quoteLoading && <p role="status" className="text-xs text-xora-taupe-dark">Confirming current prices and availability…</p>}
                {quoteError && (
                  <div className="space-y-2">
                    <p role="alert" className="text-xs text-red-800">{quoteError}</p>
                    <button
                      type="button"
                      onClick={() => setQuoteRefreshKey((key) => key + 1)}
                      className="text-xs underline underline-offset-2"
                    >
                      Refresh order total
                    </button>
                  </div>
                )}
                {quoteNeedsReview && quote && (
                  <button
                    type="button"
                    onClick={() => setQuoteNeedsReview(false)}
                    className="w-full border border-xora-taupe/50 px-3 py-2 text-xs text-xora-charcoal hover:border-xora-charcoal"
                  >
                    I reviewed the updated total
                  </button>
                )}

                {retryKeyConflict && (
                  <button
                    type="button"
                    onClick={() => {
                      setRetryKeyConflict(false);
                      setError('');
                    }}
                    className="w-full border border-xora-taupe/50 px-3 py-2 text-xs text-xora-charcoal hover:border-xora-charcoal"
                  >
                    Start a new checkout attempt
                  </button>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={loading || cartLoading || retryKeyConflict || (isAuthenticated && (
                    !quote || quoteLoading || quoteNeedsReview || (contactDifferences.length > 0 && !contactChoice)
                  ))}
                  className="btn-luxury w-full py-4 text-xs flex items-center justify-center space-x-2"
                  id="place-order-btn"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      <span>PROCESSING ORDER...</span>
                    </>
                  ) : (
                    <span>
                      {!isAuthenticated
                        ? 'CONTINUE TO SIGN IN'
                        : paymentMethod === 'Cash on Delivery'
                          ? `PLACE COD ORDER (${formatInr(quote?.total ?? 0)})`
                          : `PLACE TEST ORDER (${formatInr(quote?.total ?? 0)})`}
                    </span>
                  )}
                </button>

                {isAuthenticated && quote && <div className="text-center pt-2">
                  <span className="text-[10px] text-xora-taupe-dark flex items-center justify-center space-x-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Payment is not processed in this local checkout.</span>
                  </span>
                </div>}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
