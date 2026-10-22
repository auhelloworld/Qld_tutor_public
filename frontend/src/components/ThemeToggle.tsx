'use client';

import React, { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

interface ThemeToggleProps {
  /** When true, renders as an inline button without fixed positioning. */
  inline?: boolean;
}

export default function ThemeToggle({ inline = false }: ThemeToggleProps) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    // Determine initial theme on client mount
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setTheme('dark');
      document.documentElement.classList.add('dark');
    } else {
      setTheme('light');
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    if (theme === 'light') {
      setTheme('dark');
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      setTheme('light');
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  return (
    <button
      onClick={toggleTheme}
      className="theme-toggle-btn"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      style={{
        ...(inline ? {} : { position: 'fixed', top: '20px', right: '20px', zIndex: 1000 }),
        width: inline ? '36px' : '44px',
        height: inline ? '36px' : '44px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-glass)',
        border: '1px solid var(--border-color)',
        boxShadow: inline ? 'none' : 'var(--accent-glow)',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        padding: 0,
        color: 'var(--text-primary)',
        flexShrink: 0,
      }}
    >
      <div style={{ position: 'relative', width: '20px', height: '20px' }}>
        <span
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: theme === 'light' ? 'scale(1) rotate(0)' : 'scale(0) rotate(90deg)',
            opacity: theme === 'light' ? 1 : 0,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            color: '#f59e0b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Sun size={20} />
        </span>
        <span
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: theme === 'dark' ? 'scale(1) rotate(0)' : 'scale(0) rotate(-90deg)',
            opacity: theme === 'dark' ? 1 : 0,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            color: '#818cf8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Moon size={20} />
        </span>
      </div>
    </button>
  );
}
