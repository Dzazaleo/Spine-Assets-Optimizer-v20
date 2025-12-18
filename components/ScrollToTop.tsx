
import React, { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import clsx from 'clsx';

export const ScrollToTop: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      if (window.scrollY > 300) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener('scroll', toggleVisibility, { passive: true });
    return () => window.removeEventListener('scroll', toggleVisibility);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      className={clsx(
        "fixed bottom-8 right-8 z-40 p-3 rounded-full bg-spine-accent text-white shadow-2xl transition-all duration-300 hover:bg-red-500 hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/20",
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10 pointer-events-none"
      )}
      aria-label="Scroll to top"
    >
      <ArrowUp size={24} strokeWidth={2.5} />
    </button>
  );
};
