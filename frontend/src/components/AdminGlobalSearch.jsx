import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { adminService } from '../services/api.js';

export default function AdminGlobalSearch({ onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const focusSearch = (event) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setStatus('idle');
      return undefined;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setStatus('loading');
      try {
        const response = await adminService.globalSearch(term, { signal: controller.signal });
        setResults(Array.isArray(response.data.results) ? response.data.results : []);
        setStatus('ready');
        setActiveIndex(-1);
      } catch {
        if (controller.signal.aborted) return;
        setResults([]);
        setStatus('error');
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [open]);

  const choose = (result) => {
    onSelect(result);
    setOpen(false);
    setQuery('');
    setResults([]);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    }
    if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    }
    if (event.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  };

  const expanded = open && (status === 'loading' || status === 'error' || query.trim().length >= 2);
  return (
    <div className="admin-global-search" ref={rootRef}>
      <label className="admin-global-search__field">
        <Search size={17} aria-hidden="true" />
        <span className="sr-only">Search products, orders, and customers</span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search products, orders, and customers"
          aria-keyshortcuts="Control+K Meta+K Escape"
          title="Press Ctrl+K or Command+K to search; Escape closes results"
          aria-expanded={expanded}
          aria-controls="admin-global-search-results"
          aria-activedescendant={activeIndex >= 0 ? `admin-global-search-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          placeholder="Search products, orders, customers"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
        />
        {query && <button type="button" className="admin-global-search__clear" aria-label="Clear search" onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}><X size={15} /></button>}
      </label>
      {expanded && (
        <div className="admin-global-search__results" id="admin-global-search-results" role="listbox" aria-label="Global search results">
          {status === 'loading' && <p className="admin-global-search__message" role="status">Searching…</p>}
          {status === 'error' && <p className="admin-global-search__message" role="alert">Search is unavailable. Try again.</p>}
          {status === 'ready' && results.length === 0 && <p className="admin-global-search__message">No matching records.</p>}
          {status === 'ready' && results.map((result, index) => (
            <button
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              id={`admin-global-search-option-${index}`}
              className="admin-global-search__option"
              key={`${result.type}-${result.id}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(result)}
            >
              <span className="admin-global-search__option-label">{result.label}</span>
              <span className="admin-global-search__option-detail">{result.detail || result.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
