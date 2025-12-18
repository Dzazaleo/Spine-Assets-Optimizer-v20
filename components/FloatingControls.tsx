
import React, { useState, useEffect } from 'react';
import { ArrowUp, Search, X } from 'lucide-react';
import clsx from 'clsx';

interface FloatingControlsProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onClear: () => void;
}

export const FloatingControls: React.FC<FloatingControlsProps> = ({
  searchTerm,
  onSearchChange,
  onClear,
}) => {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  const showScrollTop = scrollY > 300;
  const showFloatingSearch = scrollY > 900;

  return (
    <div className="fixed bottom-8 right-8 z-40 flex items-center gap-3">
      {/* Floating Search Bar */}
      <div
        className={clsx(
          "flex items-center gap-2 bg-gray-800/90 backdrop-blur-md border border-gray-600 rounded-full px-4 py-2 shadow-2xl transition-all duration-500 ease-out",
          showFloatingSearch 
            ? "opacity-100 translate-y-0 pointer-events-auto" 
            : "opacity-0 translate-y-4 pointer-events-none"
        )}
      >
        <Search size={16} className="text-gray-400" />
        <input
          type="text"
          placeholder="Filter assets..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="bg-transparent border-none text-sm text-gray-100 focus:outline-none focus:ring-0 w-32 md:w-48 placeholder:text-gray-500"
        />
        {searchTerm && (
          <button
            onClick={onClear}
            className="p-1 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Scroll to Top Button */}
      <button
        type="button"
        onClick={scrollToTop}
        className={clsx(
          "p-3 rounded-full bg-spine-accent text-white shadow-2xl transition-all duration-300 hover:bg-red-500 hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/20",
          showScrollTop 
            ? "opacity-100 scale-100 translate-y-0" 
            : "opacity-0 scale-90 translate-y-10 pointer-events-none"
        )}
        aria-label="Scroll to top"
      >
        <ArrowUp size={24} strokeWidth={2.5} />
      </button>
    </div>
  );
};
