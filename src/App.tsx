/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { EnhancedChannel, PlaybackQuality } from './types.ts';
import { enhancedChannels } from './data.ts';
import { Header } from './components/Header.tsx';
import { VideoPlayer } from './components/VideoPlayer.tsx';
import { CategoryBar } from './components/CategoryBar.tsx';
import { ChannelContainer } from './components/ChannelContainer.tsx';
import { FullscreenChannelPanel } from './components/FullscreenChannelPanel.tsx';
import { playBeep, initAudio } from './utils/beep.ts';
import { UserCredential } from './users/credentials.ts';
import { Login } from './components/Login.tsx';
import { PlaylistModal } from './components/PlaylistModal.tsx';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserCredential | null>(() => {
    const saved = localStorage.getItem('tv_logged_in_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const [activePlaylistName, setActivePlaylistName] = useState<string>(() => {
    return localStorage.getItem('iptv_active_playlist_name') || 'Default Channels';
  });

  const [channels, setChannels] = useState<EnhancedChannel[]>(() => {
    const savedName = localStorage.getItem('iptv_active_playlist_name') || 'Default Channels';
    if (savedName !== 'Default Channels') {
      const saved = localStorage.getItem('iptv_saved_playlists');
      if (saved) {
        try {
          const playlists = JSON.parse(saved);
          const found = playlists.find((p: any) => p.name === savedName);
          if (found && found.channels.length > 0) {
            return found.channels;
          }
        } catch (e) {}
      }
    }
    return enhancedChannels;
  });

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  // Active streaming states
  const [activeChannel, setActiveChannel] = useState<EnhancedChannel | null>(() => {
    const initialChannels = (() => {
      const savedName = localStorage.getItem('iptv_active_playlist_name') || 'Default Channels';
      if (savedName !== 'Default Channels') {
        const saved = localStorage.getItem('iptv_saved_playlists');
        if (saved) {
          try {
            const playlists = JSON.parse(saved);
            const found = playlists.find((p: any) => p.name === savedName);
            if (found && found.channels.length > 0) {
              return found.channels;
            }
          } catch (e) {}
        }
      }
      return enhancedChannels;
    })();

    const categoryPriority = ['sports', 'news', 'kids', 'bangla', 'hindi', 'english', 'sonatoni', 'islamic', 'youtube'];
    for (const catId of categoryPriority) {
      const found = initialChannels.find(ch => ch.category === catId);
      if (found) return found;
    }
    return initialChannels[0] || null;
  });

  const [playbackQuality, setPlaybackQuality] = useState<PlaybackQuality>('auto');
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);
  
  // Layout panels
  const [isFullscreenPanelOpen, setIsFullscreenPanelOpen] = useState<boolean>(false);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');
  const [toastIsError, setToastIsError] = useState<boolean>(false);

  // Simulated active channel viewer count
  const [activeViewerCount, setActiveViewerCount] = useState<number>(0);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);

  // Toast notifier
  const triggerToast = useCallback((msg: string, isErr: boolean = false) => {
    setToastMessage(msg);
    setToastIsError(isErr);
    const id = setTimeout(() => {
      setToastMessage('');
    }, 3000);
    return () => clearTimeout(id);
  }, []);

  // Dynamic playlist load actions
  const handlePlaylistLoaded = useCallback((newChannels: EnhancedChannel[], name: string) => {
    setChannels(newChannels);
    setActivePlaylistName(name);
    localStorage.setItem('iptv_active_playlist_name', name);
    
    const categoryPriority = ['sports', 'news', 'kids', 'bangla', 'hindi', 'english', 'sonatoni', 'islamic', 'youtube'];
    let defaultCh = null;
    for (const catId of categoryPriority) {
      const found = newChannels.find(ch => ch.category === catId);
      if (found) {
        defaultCh = found;
        break;
      }
    }
    if (!defaultCh) defaultCh = newChannels[0] || null;
    
    setActiveChannel(defaultCh);
    setActiveCategory('all');
    setSearchTerm('');
    triggerToast(`📅 Loaded Playlist: ${name}`);
  }, [triggerToast]);

  const handleSelectDefaultPlaylist = useCallback(() => {
    setChannels(enhancedChannels);
    setActivePlaylistName('Default Channels');
    localStorage.setItem('iptv_active_playlist_name', 'Default Channels');
    
    const categoryPriority = ['sports', 'news', 'kids', 'bangla', 'hindi', 'english', 'sonatoni', 'islamic', 'youtube'];
    let defaultCh = null;
    for (const catId of categoryPriority) {
      const found = enhancedChannels.find(ch => ch.category === catId);
      if (found) {
        defaultCh = found;
        break;
      }
    }
    if (!defaultCh) defaultCh = enhancedChannels[0] || null;
    
    setActiveChannel(defaultCh);
    setActiveCategory('all');
    setSearchTerm('');
    triggerToast("✨ Restored Default Playlist!");
  }, [triggerToast]);

  // Compute category bar choices dynamically based on loaded list of channels
  const dynamicCategories = useMemo(() => {
    const baseCategories = [{ id: 'all', label: 'All Channels' }];
    const uniqueCategories = Array.from(new Set(channels.map(c => c.category))).filter(Boolean) as string[];
    
    // Sort uniqueCategories based on standard priority, putting sports and news at the very top
    const priority = ['sports', 'news', 'bangla', 'kids', 'hindi', 'english', 'sonatoni', 'islamic', 'youtube'];
    uniqueCategories.sort((a, b) => {
      const idxA = priority.indexOf(a.toLowerCase());
      const idxB = priority.indexOf(b.toLowerCase());
      if (idxA === -1 && idxB === -1) return a.localeCompare(b);
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });

    const labelMap: Record<string, string> = {
      'sports': 'Sports',
      'news': 'News',
      'kids': 'Kids',
      'bangla': 'Bangla',
      'hindi': 'Hindi',
      'english': 'English',
      'sonatoni': 'Sonatoni',
      'islamic': 'Islamic',
      'youtube': 'Youtube'
    };

    uniqueCategories.forEach(catId => {
      if (catId === 'all') return;
      baseCategories.push({
        id: catId,
        label: labelMap[catId] || catId.charAt(0).toUpperCase() + catId.slice(1)
      });
    });

    return baseCategories;
  }, [channels]);

  // Update active channel viewer counts elegantly on set or interval
  useEffect(() => {
    if (!activeChannel) {
      setActiveViewerCount(0);
      return;
    }
    
    // Deterministic base viewer count from url
    let hash = 0;
    const url = activeChannel.url;
    for (let i = 0; i < url.length; i++) {
      hash = url.charCodeAt(i) + ((hash << 5) - hash);
    }
    const initialCount = Math.abs(hash % 4500) + 165;
    setActiveViewerCount(initialCount);

    const interval = setInterval(() => {
      setActiveViewerCount(prev => {
        const delta = Math.floor(Math.random() * 81) - 40;
        let newVal = prev + delta;
        if (newVal < 15) newVal = 15;
        if (newVal > 15000) newVal = 15000;
        return newVal;
      });
    }, 8000);

    return () => clearInterval(interval);
  }, [activeChannel]);

  // Filter channels based on active query
  const filteredChannels = useMemo(() => {
    let result = channels;
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      result = result.filter(ch => 
        ch.name.toLowerCase().includes(term) || 
        ch.short.toLowerCase().includes(term)
      );
    } else if (activeCategory !== 'all') {
      result = result.filter(ch => ch.category === activeCategory);
    }
    return result;
  }, [channels, activeCategory, searchTerm]);

  // Handle stream initialization on manual/keyboard picks
  const handleSelectChannel = useCallback((url: string, name: string, el?: HTMLElement) => {
    setSearchTerm('');

    const ch = channels.find(item => item.url === url) || null;
    if (!ch) {
      triggerToast("❌ Invalid stream source", true);
      return;
    }

    if (activeChannel?.url === url) {
      // Force reload/replay active stream when clicked again
      setReloadTrigger(prev => prev + 1);
      if (el) {
        el.focus();
      } else {
        setTimeout(() => {
          const activeCard = document.querySelector(`.channel-logo-card[data-url="${url}"]`) as HTMLElement;
          if (activeCard) activeCard.focus();
        }, 50);
      }
      return;
    }

    setActiveChannel(ch);

    // If initial load bypassed autoplay restrictions, make sure to unmute
    if (videoElementRef.current) {
      if (videoElementRef.current.muted) {
        videoElementRef.current.muted = false;
      }
    }

    // Removed toast alert for channel loading as per user request


    // Apply active classes to all matching elements across lists
    document.querySelectorAll('.channel-logo-card').forEach(c => {
      c.classList.remove('active-channel');
      if (c.getAttribute('data-url') === url) {
        c.classList.add('active-channel');
      }
    });
    
    document.querySelectorAll('.strip-item').forEach(c => {
      c.classList.remove('active-channel');
      if (c.getAttribute('data-url') === url) {
        c.classList.add('active-channel');
      }
    });
    
    document.querySelectorAll('.fs-channel-item').forEach(c => {
      c.classList.remove('active-channel');
      if (c.getAttribute('data-url') === url) {
        c.classList.add('active-channel');
      }
    });

    if (el) {
      el.focus();
    } else {
      setTimeout(() => {
        const activeCard = document.querySelector(`.channel-logo-card[data-url="${url}"]`) as HTMLElement;
        if (activeCard) {
          activeCard.focus();
        }
      }, 50);
    }
  }, [activeChannel, triggerToast, channels]);

  const playNextPrevChannel = useCallback((direction: 'next' | 'prev') => {
    if (!activeChannel) return;
    
    // Choose list: filteredChannels (under active category/search), fallback to channels
    let list = filteredChannels;
    let idx = list.findIndex(ch => ch.url === activeChannel.url);
    
    if (idx === -1) {
      list = channels;
      idx = list.findIndex(ch => ch.url === activeChannel.url);
    }
    
    if (idx === -1 || list.length <= 1) return;
    
    let targetIdx = idx;
    if (direction === 'next') {
      targetIdx = (idx + 1) % list.length;
    } else {
      targetIdx = (idx - 1 + list.length) % list.length;
    }
    
    const targetChannel = list[targetIdx];
    if (targetChannel) {
      handleSelectChannel(targetChannel.url, targetChannel.name);
      playBeep('select');
    }
  }, [activeChannel, filteredChannels, handleSelectChannel, channels]);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('tv_logged_in_user');
    setCurrentUser(null);
    triggerToast("🔓 Signed out successfully!");
  }, [triggerToast]);

  // Close overlay panels on backdrop clicks
  const handleCloseFullscreenPanel = useCallback(() => {
    setIsFullscreenPanelOpen(false);
  }, []);

  const handleOpenFullscreenPanel = useCallback(() => {
    setIsFullscreenPanelOpen(true);
  }, []);

  // Focus mappings used for TV/Remote keyboard arrow-navigation control
  const getFocusableElements = useCallback(() => {
    const cats = Array.from(document.querySelectorAll('.category-btn')) as HTMLElement[];
    const cards = Array.from(document.querySelectorAll('.channel-logo-card')) as HTMLElement[];
    const strips = Array.from(document.querySelectorAll('.strip-item')) as HTMLElement[];
    const fsItems = Array.from(document.querySelectorAll('.fs-channel-item')) as HTMLElement[];
    const closeBtn = document.getElementById('closePanelBtn');
    const toggleBtn = document.getElementById('fsToggleBtn');
    const searchInput = document.getElementById('searchInput');
    const qualityBtn = document.getElementById('qualityBtn');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const qualityOpts = Array.from(document.querySelectorAll('.quality-opt-btn')) as HTMLElement[];

    const isCurrentlyFullscreen = !!(
      document.fullscreenElement || 
      (document as any).webkitFullscreenElement || 
      (document as any).mozFullScreenElement || 
      (document as any).msFullscreenElement ||
      document.getElementById('videoPlayerOuterContainer')?.classList.contains('fixed')
    );

    let elems: HTMLElement[] = [];

    if (isCurrentlyFullscreen) {
      if (isFullscreenPanelOpen) {
        elems = [...fsItems];
        if (closeBtn) elems.push(closeBtn);
      } else {
        // When in fullscreen only allow focusing player controls
        if (playPauseBtn) elems.push(playPauseBtn);
        if (qualityBtn) elems.push(qualityBtn);
        if (qualityOpts.length > 0) elems = [...elems, ...qualityOpts];
        if (toggleBtn) elems.push(toggleBtn);
      }
    } else {
      if (searchInput) elems.push(searchInput);
      if (playPauseBtn) elems.push(playPauseBtn);
      if (qualityBtn) elems.push(qualityBtn);
      if (qualityOpts.length > 0) elems = [...elems, ...qualityOpts];
      elems = [...elems, ...cats];

      const isStripActive = searchTerm.trim().length > 0 && filteredChannels.length > 0;
      if (isStripActive) {
        elems = [...elems, ...strips, ...cards];
      } else {
        elems = [...elems, ...cards];
      }
      if (toggleBtn) elems.push(toggleBtn);
    }
    return elems.filter(el => el && el.offsetParent !== null);
  }, [isFullscreenPanelOpen, searchTerm, filteredChannels]);

  // Handle arrow-key selection transfer
  const moveFocus = useCallback((dir: 'left' | 'right' | 'up' | 'down') => {
    const focusable = getFocusableElements();
    if (!focusable.length) return;

    const active = document.activeElement as HTMLElement;
    if (!active || !focusable.includes(active)) {
      const activeCard = document.querySelector('.channel-logo-card.active-channel') as HTMLElement;
      if (activeCard && focusable.includes(activeCard)) {
        activeCard.focus();
        activeCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        focusable[0]?.focus();
      }
      return;
    }

    // Advanced 2D Spatial Navigation
    const activeRect = active.getBoundingClientRect();
    const activeCenter = {
      x: activeRect.left + activeRect.width / 2,
      y: activeRect.top + activeRect.height / 2,
    };

    // Helper to determine the type/row group of an element to prevent horizontal level jumping
    const getElType = (el: HTMLElement) => {
      if (el.classList.contains('fs-cat-btn')) return 'fs-cat';
      if (el.classList.contains('fs-channel-card')) return 'fs-card';
      if (el.classList.contains('channel-logo-card')) {
        const rowGroup = el.getAttribute('data-group-row');
        if (rowGroup) {
          return `card-row-${rowGroup}`;
        }
        const groupGrid = el.closest('.group-channel-grid');
        if (groupGrid) {
          const heading = groupGrid.parentElement?.querySelector('h3')?.textContent || 'grouped-card';
          return `card-row-${heading}`;
        }
        return 'card';
      }
      if (el.classList.contains('category-btn')) return 'category';
      if (el.classList.contains('strip-item')) return 'strip';
      if (el.classList.contains('fs-channel-item')) return 'fs-item';
      if (el.classList.contains('quality-opt-btn')) return 'qualityOpt';
      if (el.id === 'qualityBtn' || el.id === 'fsToggleBtn' || el.id === 'playPauseBtn') return 'playerControls';
      if (el.id === 'searchInput') return 'topBar';
      return 'other';
    };

    const activeType = getElType(active);

    const getTier = (el: HTMLElement) => {
      const type = getElType(el);
      if (type === 'topBar') {
        return 'TOP_BAR';
      }
      if (type === 'strip') {
        return 'SEARCH_STRIP';
      }
      if (type === 'playerControls' || type === 'qualityOpt') {
        return 'PLAYER_CONTROLS';
      }
      if (type === 'category') {
        return 'CATEGORIES';
      }
      if (type.startsWith('card-row-') || type === 'card') {
        return 'CHANNELS';
      }
      return 'OTHER';
    };

    // If moving left/right horizontally, strictly scan elements of the exact same visual type
    let candidates = focusable;
    if (dir === 'left' || dir === 'right') {
      candidates = focusable.filter(el => getElType(el) === activeType);

      if (
        activeType.startsWith('card-row-') ||
        activeType === 'category' ||
        activeType === 'strip' ||
        activeType === 'fs-cat' ||
        activeType === 'fs-card'
      ) {
        // Strict index-based sequential movement that does NOT wrap across categories or loop
        const idx = candidates.indexOf(active);
        if (idx !== -1) {
          let targetEl: HTMLElement | null = null;
          if (dir === 'right' && idx < candidates.length - 1) {
            targetEl = candidates[idx + 1];
          } else if (dir === 'left' && idx > 0) {
            targetEl = candidates[idx - 1];
          }

          if (targetEl) {
            targetEl.focus();
            try {
              targetEl.scrollIntoView({ block: 'nearest', behavior: 'instant' } as any);
            } catch (e) {
              targetEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
            }
            playBeep('move');
          }
          return; // Done
        }
      }
    } else {
      // For vertical (up/down) movement, enforce strict row/tier-by-row traversal:
      // TOP_BAR <-> SEARCH_STRIP <-> PLAYER_CONTROLS <-> CATEGORIES <-> CHANNELS
      const activeTier = getTier(active);
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement || 
        (document as any).webkitFullscreenElement || 
        (document as any).mozFullScreenElement || 
        (document as any).msFullscreenElement ||
        document.getElementById('videoPlayerOuterContainer')?.classList.contains('fixed')
      );

      if (!isCurrentlyFullscreen) {
        if (dir === 'up') {
          if (activeTier === 'CHANNELS') {
            // Find any channel elements physically above active
            const channelsAbove = focusable.filter(el => {
              if (getTier(el) !== 'CHANNELS') return false;
              const r = el.getBoundingClientRect();
              const centerY = r.top + r.height / 2;
              return centerY < activeCenter.y - 12; // 12px vertical alignment threshold
            });
            if (channelsAbove.length > 0) {
              candidates = channelsAbove;
            } else {
              // No channels above -> must go up to categories bar
              candidates = focusable.filter(el => getTier(el) === 'CATEGORIES');
              if (candidates.length === 0) {
                candidates = focusable.filter(el => getTier(el) === 'PLAYER_CONTROLS');
              }
              if (candidates.length === 0) {
                candidates = focusable.filter(el => getTier(el) === 'SEARCH_STRIP');
              }
              if (candidates.length === 0) {
                candidates = focusable.filter(el => getTier(el) === 'TOP_BAR');
              }
            }
          } else if (activeTier === 'CATEGORIES') {
            candidates = focusable.filter(el => getTier(el) === 'PLAYER_CONTROLS');
            if (candidates.length === 0) {
              candidates = focusable.filter(el => getTier(el) === 'SEARCH_STRIP');
            }
            if (candidates.length === 0) {
              candidates = focusable.filter(el => getTier(el) === 'TOP_BAR');
            }
          } else if (activeTier === 'PLAYER_CONTROLS') {
            candidates = focusable.filter(el => getTier(el) === 'SEARCH_STRIP');
            if (candidates.length === 0) {
              candidates = focusable.filter(el => getTier(el) === 'TOP_BAR');
            }
          } else if (activeTier === 'SEARCH_STRIP') {
            candidates = focusable.filter(el => getTier(el) === 'TOP_BAR');
          } else if (activeTier === 'TOP_BAR') {
            candidates = focusable.filter(el => getTier(el) === 'TOP_BAR');
          }
        } else if (dir === 'down') {
          if (activeTier === 'TOP_BAR') {
            candidates = focusable.filter(el => getTier(el) === 'SEARCH_STRIP');
            if (candidates.length === 0) {
              candidates = focusable.filter(el => getTier(el) === 'PLAYER_CONTROLS');
            }
            if (candidates.length === 0) {
              candidates = focusable.filter(el => getTier(el) === 'CATEGORIES');
            }
            if (candidates.length === 0) {
              candidates = focusable.filter(el => getTier(el) === 'CHANNELS');
            }
          } else if (activeTier === 'SEARCH_STRIP') {
            candidates = focusable.filter(el => getTier(el) === 'PLAYER_CONTROLS');
            if (candidates.length === 0) {
              candidates = focusable.filter(el => getTier(el) === 'CATEGORIES');
            }
            if (candidates.length === 0) {
              candidates = focusable.filter(el => getTier(el) === 'CHANNELS');
            }
          } else if (activeTier === 'PLAYER_CONTROLS') {
            candidates = focusable.filter(el => getTier(el) === 'CATEGORIES');
            if (candidates.length === 0) {
              candidates = focusable.filter(el => getTier(el) === 'CHANNELS');
            }
          } else if (activeTier === 'CATEGORIES') {
            candidates = focusable.filter(el => getTier(el) === 'CHANNELS');
          } else if (activeTier === 'CHANNELS') {
            // Find any channel elements physically below active (subsequent rows)
            const channelsBelow = focusable.filter(el => {
              if (getTier(el) !== 'CHANNELS') return false;
              const r = el.getBoundingClientRect();
              const centerY = r.top + r.height / 2;
              return centerY > activeCenter.y + 12; // 12px vertical alignment threshold
            });
            candidates = channelsBelow;
          }
        }
      }
    }

    let bestElem: HTMLElement | null = null;
    let minDistance = Infinity;

    for (const el of candidates) {
      if (el === active) continue;

      const rect = el.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };

      let dPrimary = 0;
      let dSecondary = 0;
      let isValidCandidate = false;

      // Check alignment based on target direction with small pixel threshold
      if (dir === 'up') {
        isValidCandidate = center.y < activeCenter.y - 2;
        dPrimary = activeCenter.y - center.y;
        dSecondary = Math.abs(activeCenter.x - center.x);
      } else if (dir === 'down') {
        isValidCandidate = center.y > activeCenter.y + 2;
        dPrimary = center.y - activeCenter.y;
        dSecondary = Math.abs(activeCenter.x - center.x);
      } else if (dir === 'left') {
        isValidCandidate = center.x < activeCenter.x - 2;
        dPrimary = activeCenter.x - center.x;
        dSecondary = Math.abs(activeCenter.y - center.y);
      } else if (dir === 'right') {
        isValidCandidate = center.x > activeCenter.x + 2;
        dPrimary = center.x - activeCenter.x;
        dSecondary = Math.abs(activeCenter.y - center.y);
      }

      if (isValidCandidate) {
        // Linear distance model with heavy secondary axis penalty to keep straight directional paths
        const distance = dPrimary + dSecondary * 5.0;
        if (distance < minDistance) {
          minDistance = distance;
          bestElem = el;
        }
      }
    }

    if (bestElem) {
      bestElem.focus();
      try {
        bestElem.scrollIntoView({ block: 'nearest', behavior: 'instant' } as any);
      } catch (e) {
        bestElem.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }
      playBeep('move');
    } else {
      // Direct left-right fallback navigation when reaching horizontal boundaries
      // We do NOT wrap across boundaries to ensure a smooth, stable experience
      const idx = candidates.indexOf(active);
      if (idx !== -1 && (dir === 'left' || dir === 'right')) {
        let nextIdx = idx;
        if (dir === 'right') {
          if (idx === candidates.length - 1) {
            return; // Stop at the end, do not wrap around
          }
          nextIdx = idx + 1;
        } else if (dir === 'left') {
          if (idx === 0) {
            return; // Stop at the beginning, do not wrap around
          }
          nextIdx = idx - 1;
        }
        
        const fallbackEl = candidates[nextIdx];
        if (fallbackEl) {
          fallbackEl.focus();
          try {
            fallbackEl.scrollIntoView({ block: 'nearest', behavior: 'instant' } as any);
          } catch (e) {
            fallbackEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          }
          playBeep('move');
        }
      }
    }
  }, [getFocusableElements]);

  // Hook globally captured arrow keys
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const key = e.key;

      const isCurrentlyFullscreen = !!(
        document.fullscreenElement || 
        (document as any).webkitFullscreenElement || 
        (document as any).mozFullScreenElement || 
        (document as any).msFullscreenElement ||
        document.getElementById('videoContainer')?.classList.contains('fixed')
      );

      // If we are in fullscreen and overlay list is closed, left/right triggers previous/next channel
      if (isCurrentlyFullscreen && !isFullscreenPanelOpen) {
        if (key === 'ArrowRight') {
          e.preventDefault();
          playNextPrevChannel('next');
          return;
        }
        if (key === 'ArrowLeft') {
          e.preventDefault();
          playNextPrevChannel('prev');
          return;
        }
      }

      // Down arrow triggers quick channel overlay tray if matching player view
      if (document.fullscreenElement && key === 'ArrowDown' && !isFullscreenPanelOpen) {
        e.preventDefault();
        setIsFullscreenPanelOpen(true);
        playBeep('select');
        return;
      }

      // Close tray on Escape, Backspace, BrowserBack, or GoBack (unless typing in searchInput)
      const activeEl = document.activeElement as HTMLElement;
      const isSearchFocused = activeEl && activeEl.id === 'searchInput';
      const isTVBackKey = key === 'Escape' || key === 'Backspace' || key === 'BrowserBack' || key === 'GoBack';
      if (isTVBackKey && !isSearchFocused && isFullscreenPanelOpen) {
        e.preventDefault();
        setIsFullscreenPanelOpen(false);
        playBeep('select');
        return;
      }

      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        const activeEl = document.activeElement as HTMLElement;
        const isSearchFocused = activeEl && activeEl.id === 'searchInput';

        // Let left/right work normally inside the search bar for text selection/movement
        if (isSearchFocused && (key === 'ArrowLeft' || key === 'ArrowRight')) {
          return;
        }

        e.preventDefault();
        const mapping: { [key: string]: 'left' | 'right' | 'up' | 'down' } = {
          'ArrowLeft': 'left',
          'ArrowRight': 'right',
          'ArrowUp': 'up',
          'ArrowDown': 'down'
        };
        moveFocus(mapping[key]);
      } else if (key === 'Enter' || key === ' ' || key === 'Select') {
        const active = document.activeElement as HTMLElement;
        // Let normal browser triggers do input spacebar/inputs, others play beep sound
        if (active && active.id !== 'searchInput') {
          e.preventDefault();
          playBeep('select');
          if (active.click) active.click();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isFullscreenPanelOpen, moveFocus, playNextPrevChannel]);

  // Audio system startup and video unmute on first user interaction
  useEffect(() => {
    const handleInitializeAudioSystem = () => {
      initAudio();
      if (videoElementRef.current) {
        videoElementRef.current.muted = false;
        videoElementRef.current.play().catch(() => {});
      }
    };

    document.body.addEventListener('click', handleInitializeAudioSystem, { once: true, passive: true });
    document.body.addEventListener('keydown', handleInitializeAudioSystem, { once: true, passive: true });
    document.body.addEventListener('pointerdown', handleInitializeAudioSystem, { once: true, passive: true });
    return () => {
      document.body.removeEventListener('click', handleInitializeAudioSystem);
      document.body.removeEventListener('keydown', handleInitializeAudioSystem);
      document.body.removeEventListener('pointerdown', handleInitializeAudioSystem);
    };
  }, []);

  // Disable right-click globally
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  // Focus the active channel card immediately on startup/mount so remote/keyboard navigation is active instantly
  useEffect(() => {
    const focusInitialElement = () => {
      try {
        window.focus();
      } catch (e) {}
      const activeCard = document.querySelector('.channel-logo-card.active-channel') as HTMLElement;
      if (activeCard) {
        if (document.activeElement === document.body || !document.activeElement) {
          activeCard.focus();
          activeCard.scrollIntoView({ block: 'nearest', behavior: 'instant' } as any);
        }
      } else {
        const firstCard = document.querySelector('.channel-logo-card') as HTMLElement;
        if (firstCard && (document.activeElement === document.body || !document.activeElement)) {
          firstCard.focus();
        }
      }
    };

    const timer1 = setTimeout(focusInitialElement, 150);
    const timer2 = setTimeout(focusInitialElement, 500);
    const timer3 = setTimeout(focusInitialElement, 1200);

    // Event listeners to capture physical user presence and activate navigation focus immediately
    const handleUserPresence = () => {
      if (document.activeElement === document.body || !document.activeElement) {
        focusInitialElement();
      }
    };

    window.addEventListener('focus', handleUserPresence);
    window.addEventListener('pointermove', handleUserPresence, { once: true, passive: true });
    window.addEventListener('pointerdown', handleUserPresence, { once: true, passive: true });
    window.addEventListener('keydown', handleUserPresence, { once: true, passive: true });
    window.addEventListener('click', handleUserPresence, { once: true, passive: true });

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      window.removeEventListener('focus', handleUserPresence);
      window.removeEventListener('pointermove', handleUserPresence);
      window.removeEventListener('pointerdown', handleUserPresence);
      window.removeEventListener('keydown', handleUserPresence);
      window.removeEventListener('click', handleUserPresence);
    };
  }, []);

  if (!currentUser) {
    return <Login onLoginSuccess={setCurrentUser} />;
  }

  return (
    <div className="h-screen text-[#f1f5f9] select-none flex flex-col relative overflow-hidden bg-transparent">
      
      {/* Top Fixed Area */}
      <div className="flex-none bg-transparent z-10 animate-fade-in">
        {/* Header section comprising Search, indicators, suggestions horizontal strip */}
        <Header
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          filteredChannels={filteredChannels}
          activeChannelUrl={activeChannel?.url || null}
          onSelectChannel={handleSelectChannel}
          inputRef={searchInputRef}
          currentUser={currentUser}
          onLogout={handleLogout}
          onOpenPlaylist={() => setIsPlaylistModalOpen(true)}
        />

        {/* Video Streaming Player Component */}
        <VideoPlayer
          url={activeChannel?.url || null}
          reloadTrigger={reloadTrigger}
          channelName={activeChannel?.name || "Live Channel"}
          playbackQuality={playbackQuality}
          setPlaybackQuality={setPlaybackQuality}
          viewerCount={activeViewerCount}
          onVideoRef={(el) => {
            videoElementRef.current = el;
          }}
          filteredChannels={filteredChannels}
          activeChannelUrl={activeChannel?.url || null}
          onSelectChannel={handleSelectChannel}
          isFullscreenPanelOpen={isFullscreenPanelOpen}
          setIsFullscreenPanelOpen={setIsFullscreenPanelOpen}
        />

        {/* Category selector filtering options */}
        <CategoryBar
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          onClearSearch={clearSearch}
          categoriesList={dynamicCategories}
        />
      </div>

      {/* Main Container of items - Scrollable */}
      <div className="flex-1 overflow-y-auto pb-24 scrollbar-thin scrollbar-track-transparent bg-transparent">
        <ChannelContainer
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          filteredChannels={filteredChannels}
          allChannels={channels}
          searchTerm={searchTerm}
          activeChannelUrl={activeChannel?.url || null}
          onSelectChannel={handleSelectChannel}
          categoriesList={dynamicCategories}
        />
      </div>



      {/* Responsive Toast Notification overlays */}
      {toastMessage && (
        <div 
          className={`fixed bottom-18 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-xs font-semibold z-50 shadow-xl select-none transition-all pointer-events-none ${
            toastIsError 
              ? 'bg-slate-950/90 text-amber-500 border-l-4 border-amber-500' 
              : 'bg-slate-950/95 text-white border-l-4 border-white'
          }`}
        >
          {toastMessage}
        </div>
      )}

      {/* IPTV Playlist Manager Modal */}
      <PlaylistModal
        isOpen={isPlaylistModalOpen}
        onClose={() => setIsPlaylistModalOpen(false)}
        onPlaylistLoaded={handlePlaylistLoaded}
        onSelectDefaultPlaylist={handleSelectDefaultPlaylist}
        activePlaylistName={activePlaylistName}
      />
    </div>
  );
}
