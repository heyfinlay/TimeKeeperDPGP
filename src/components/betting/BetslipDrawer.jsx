import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Betslip from '@/components/betting/Betslip.jsx';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function BetslipDrawer({ open, onClose, marketId, outcomeId, onSuccess }) {
  const drawerRef = useRef(null);
  const lastFocusedRef = useRef(null);

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined;
    }

    lastFocusedRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusFirst = () => {
      const node = drawerRef.current;
      if (!node) return;
      const focusable = node.querySelectorAll(FOCUSABLE);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        node.focus();
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (typeof onClose === 'function') {
          onClose();
        }
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const node = drawerRef.current;
      if (!node) {
        return;
      }

      const focusable = node.querySelectorAll(FOCUSABLE);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first || !node.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const timer = window.requestAnimationFrame(focusFirst);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(timer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (lastFocusedRef.current && typeof lastFocusedRef.current.focus === 'function') {
        lastFocusedRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        aria-hidden="true"
        onClick={() => {
          if (typeof onClose === 'function') {
            onClose();
          }
        }}
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Betslip drawer"
        tabIndex={-1}
        className="relative z-10 flex h-full w-full max-w-full flex-col overflow-y-auto border-l border-accent-emerald/15 bg-shell-900/95 text-white shadow-shell-card transition-transform duration-200 ease-out sm:max-w-md"
      >
        <Betslip marketId={marketId} outcomeId={outcomeId} onClose={onClose} onSuccess={onSuccess} />
      </div>
    </div>,
    document.body,
  );
}
