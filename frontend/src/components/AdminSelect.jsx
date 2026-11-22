import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function AdminSelect({ label, value, options, onChange, disabled = false, className = '' }) {
  const id = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listboxRef = useRef(null);
  const listboxId = `${id}-listbox`;

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    listboxRef.current?.focus();
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      close();
      return;
    }

    let nextIndex;
    if (event.key === 'ArrowDown') nextIndex = Math.min(activeIndex + 1, options.length - 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(activeIndex - 1, 0);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = options.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onChange(options[activeIndex].value);
      close(true);
      return;
    } else {
      return;
    }

    event.preventDefault();
    setActiveIndex(nextIndex);
  };

  const openMenu = () => {
    if (disabled) return;
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  return (
    <div className={`admin-select-control ${className}`.trim()} ref={rootRef}>
      <span className="admin-select-control__label" id={`${id}-label`}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="admin-input admin-select-control__trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span id={`${id}-value`}>{selectedOption.label}</span>
        <ChevronDown aria-hidden="true" focusable="false" />
      </button>
      <div
        ref={listboxRef}
        id={listboxId}
        className="admin-select-control__menu"
        role="listbox"
        aria-label={label}
        aria-activedescendant={`${id}-option-${activeIndex}`}
        tabIndex={-1}
        hidden={!open}
        onKeyDown={handleKeyDown}
      >
        {options.map((option, index) => (
          <div
            key={option.value}
            id={`${id}-option-${index}`}
            className="admin-select-control__option"
            role="option"
            aria-selected={value === option.value}
            data-active={activeIndex === index}
            onMouseMove={() => setActiveIndex(index)}
            onClick={() => {
              onChange(option.value);
              close(true);
            }}
          >
            {option.label}
          </div>
        ))}
      </div>
    </div>
  );
}
