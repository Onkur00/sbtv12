/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { PlaybackQuality, EnhancedChannel } from '../types.ts';
import { playBeep } from '../utils/beep.ts';
import { Play, Pause, Volume2, VolumeX, Settings, Maximize2, Minimize2, Lock, Unlock, Tv, ShieldAlert, ExternalLink, RefreshCw, Compass, HelpCircle, Activity, Expand } from 'lucide-react';
import { FullscreenChannelPanel } from './FullscreenChannelPanel.tsx';

interface VideoPlayerProps {
  url: string | null;
  reloadTrigger?: number;
  channelName: string;
  onVideoRef: (el: HTMLVideoElement | null) => void;
  playbackQuality: PlaybackQuality;
  setPlaybackQuality: (q: PlaybackQuality) => void;
  viewerCount: number;
  filteredChannels: EnhancedChannel[];
  activeChannelUrl: string | null;
  onSelectChannel: (url: string, name: string) => void;
  isFullscreenPanelOpen: boolean;
  setIsFullscreenPanelOpen: (open: boolean) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  url,
  reloadTrigger = 0,
  channelName,
  onVideoRef,
  playbackQuality,
  setPlaybackQuality,
  viewerCount,
  filteredChannels,
  activeChannelUrl,
  onSelectChannel,
  isFullscreenPanelOpen,
  setIsFullscreenPanelOpen,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [hasQualityLevels, setHasQualityLevels] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isBuffering, setIsBuffering] = useState(true);
  const MAX_RETRIES = 3;

  // Stream proxy and native playback recovery states
  const [useProxy, setUseProxy] = useState<boolean>(false);
  const [forceNative, setForceNative] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [zoomMode, setZoomMode] = useState<'contain' | 'cover' | 'fill'>('contain');
  const [zoomNotification, setZoomNotification] = useState<string>('');
  const [dismissExtensionOverlay, setDismissExtensionOverlay] = useState<boolean>(false);

  // Resolve any wrapped chrome-extension URLs to extract the actual stream URL dynamically
  const cleanUrl = useMemo(() => {
    if (!url) return '';
    if (url.includes('chrome-extension://') || url.includes('player.html?url=')) {
      try {
        const urlObj = new URL(url);
        const nestedUrl = urlObj.searchParams.get('url');
        if (nestedUrl) return nestedUrl;
      } catch (e) {
        const match = url.match(/[?&]url=([^&]+)/);
        if (match && match[1]) {
          try {
            return decodeURIComponent(match[1]);
          } catch (_) {
            return match[1];
          }
        }
      }
    }
    return url;
  }, [url]);

  // Auto-dismiss zoom visual feedback indicator after 2 seconds
  useEffect(() => {
    if (!zoomNotification) return;
    const timer = setTimeout(() => {
      setZoomNotification('');
    }, 2000);
    return () => clearTimeout(timer);
  }, [zoomNotification]);

  const cycleZoomMode = () => {
    playBeep('select');
    setZoomMode((prev) => {
      let next: 'contain' | 'cover' | 'fill' = 'contain';
      let label = 'Fit';
      if (prev === 'contain') {
        next = 'cover';
        label = 'Zoom (Crop)';
      } else if (prev === 'cover') {
        next = 'fill';
        label = 'Stretch';
      } else {
        next = 'contain';
        label = 'Fit';
      }
      setZoomNotification(label);
      return next;
    });
  };

  const triedModes = useRef<{ direct: boolean; proxy: boolean; native: boolean }>({
    direct: false,
    proxy: false,
    native: false
  });



  // Reset error states when the channel source changes
  useEffect(() => {
    setHasError(false);
    setStatusMessage('');
    setDismissExtensionOverlay(false);
  }, [cleanUrl, url, reloadTrigger]);

  // Auto-configured stream default-routing based on domain heuristics
  useEffect(() => {
    if (!cleanUrl) return;
    triedModes.current = { direct: false, proxy: false, native: false };
    
    const isHttp = cleanUrl.startsWith('http://');
    const isLocalIspDomain = cleanUrl.includes('gpcdn.net') || cleanUrl.includes('akash') || cleanUrl.includes('toffee') || cleanUrl.includes('bpk-tv') || cleanUrl.includes('aynaott');
    const isExtensionUrl = url && (url.startsWith('chrome-extension://') || url.includes('player.html?url='));
    
    // Detect BDIX / Local Bangladesh ISP IP streams (usually raw IP addresses, or specific local domains)
    let isBdix = false;
    try {
      const u = new URL(cleanUrl);
      const isIp = /^[0-9.]+$/.test(u.hostname);
      const isLocalDomain = u.hostname.includes('.bd') || u.hostname.includes('chowdhury-shaheb.com') || u.hostname.includes('premimum.online');
      isBdix = isIp || isLocalDomain;
    } catch (_) {
      const match = cleanUrl.match(/^https?:\/\/([0-9.]+)/);
      if (match) {
        isBdix = true;
      }
    }

    if (isExtensionUrl) {
      // Force native player for Chrome Extension streams to allow interceptors to work
      setUseProxy(false);
      setForceNative(true);
    } else if (isHttp && !isBdix) {
      // Securely proxy unencrypted remote HTTP streams to bypass HTTPS Mixed Content blocks and play them inline in the system
      setUseProxy(true);
      setForceNative(false);
    } else if (isHttp && isBdix) {
      // Try proxying first (which resolves Mixed Content). If it fails (e.g. geo-locked), fallback will switch to direct
      setUseProxy(true);
      setForceNative(false);
    } else if (isLocalIspDomain) {
      // Local Bangladesh CDN streams are faster directly, but subject to CORS. We begin direct first.
      setUseProxy(false);
      setForceNative(false);
    } else {
      setUseProxy(false);
      setForceNative(false);
    }
  }, [cleanUrl, url]);

  // Self-healing fallback option
  const triggerAlternateRouteFallback = useCallback(() => {
    if (!cleanUrl) return;
    
    const isExtensionUrl = url && (url.startsWith('chrome-extension://') || url.includes('player.html?url='));

    // Mark current mode as tried
    if (!useProxy && !forceNative) {
      triedModes.current.direct = true;
    } else if (useProxy) {
      triedModes.current.proxy = true;
    } else if (forceNative) {
      triedModes.current.native = true;
    }

    console.warn("⚠️ Connection or playback issue detected. Tried modes:", triedModes.current);

    // Determine the next logical fallback mode to try
    if (!triedModes.current.proxy && !isExtensionUrl) {
      setStatusMessage("⚠️ CORS Blocked. Switching to Server Route...");
      setTimeout(() => {
        setUseProxy(true);
        setForceNative(false);
      }, 800);
    } else if (!triedModes.current.direct) {
      setStatusMessage("⚠️ Issue detected. Switching to Direct Browser Player...");
      setTimeout(() => {
        setUseProxy(false);
        setForceNative(false);
      }, 800);
    } else if (!triedModes.current.native) {
      setStatusMessage("⚠️ Direct issue. Switching to Native TV Player...");
      setTimeout(() => {
        setUseProxy(false);
        setForceNative(true);
      }, 800);
    } else {
      setStatusMessage("❌ Stream offline or unreachable.");
      setHasError(true);
      setIsBuffering(false);
    }
  }, [cleanUrl, url, useProxy, forceNative]);

  const handleVideoError = useCallback((e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const error = (e.currentTarget as HTMLVideoElement).error;
    console.warn("Native video player reported error code:", error?.code, "-", error?.message);
    
    // Ignore false-positive error events when the src is empty or being cleared/reset
    const currentSrc = e.currentTarget.src || '';
    if (!currentSrc || currentSrc === "" || currentSrc === window.location.href) {
      console.log("Ignoring native video error for empty or blank src.");
      return;
    }

    // Ignore native error events if Hls.js is active and supported, since Hls.js handles its own network and media errors
    if (Hls.isSupported() && hlsRef.current && !forceNative) {
      console.log("Ignoring native video error because Hls.js is active and managing the media engine.");
      return;
    }

    if (cleanUrl) {
      triggerAlternateRouteFallback();
    }
  }, [cleanUrl, forceNative, triggerAlternateRouteFallback]);

  // Custom controller states
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const [isMobilePortrait, setIsMobilePortrait] = useState(false);
  const [fsCategory, setFsCategory] = useState<string>('all');
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<number | null>(null);
  const hasPushedFsStateRef = useRef(false);

  // Reset category to 'all' only when entering fullscreen for the first time
  const isCurrentlyFS = isFullscreen || isPseudoFullscreen;
  const prevIsFSRef = useRef(false);

  useEffect(() => {
    if (isCurrentlyFS && !prevIsFSRef.current) {
      setFsCategory('all');
    }
    prevIsFSRef.current = isCurrentlyFS;
  }, [isCurrentlyFS]);

  // Screen lock states
  const [isLocked, setIsLocked] = useState(false);
  const [showLockFeedback, setShowLockFeedback] = useState(false);
  const feedbackTimeoutRef = useRef<number | null>(null);

  const triggerLockNotice = useCallback(() => {
    setShowLockFeedback(true);
    if (feedbackTimeoutRef.current) {
      window.clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = window.setTimeout(() => {
      setShowLockFeedback(false);
    }, 2000) as unknown as number;
  }, []);

  // Cleanup feedback timeout on component unmount
  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        window.clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  // Swipe controls for full screen mobile/tablet view
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const touchEndY = useRef<number | null>(null);

  const changeChannel = useCallback((direction: 'next' | 'prev') => {
    if (!filteredChannels || filteredChannels.length === 0) return;
    
    const currentIndex = filteredChannels.findIndex(ch => ch.url === activeChannelUrl);
    if (currentIndex === -1) return;

    let targetIndex = currentIndex;
    if (direction === 'next') {
      targetIndex = (currentIndex + 1) % filteredChannels.length;
    } else {
      targetIndex = (currentIndex - 1 + filteredChannels.length) % filteredChannels.length;
    }

    const nextChannel = filteredChannels[targetIndex];
    if (nextChannel) {
      playBeep('select');
      onSelectChannel(nextChannel.url, nextChannel.name);
    }
  }, [filteredChannels, activeChannelUrl, onSelectChannel]);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isLocked) {
      e.stopPropagation();
      triggerLockNotice();
      return;
    }
    if (isFullscreenPanelOpen) return; // Prevent interference when drawer list/categories are being scrolled

    const firstTouch = e.touches[0];
    touchStartX.current = firstTouch.clientX;
    touchStartY.current = firstTouch.clientY;
    touchEndX.current = firstTouch.clientX;
    touchEndY.current = firstTouch.clientY;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isLocked) {
      e.stopPropagation();
      return;
    }
    if (isFullscreenPanelOpen) return;

    const touch = e.touches[0];
    touchEndX.current = touch.clientX;
    touchEndY.current = touch.clientY;
  };

  const handleTouchEnd = () => {
    if (isLocked) return;
    if (isFullscreenPanelOpen) return;

    if (
      touchStartX.current === null || 
      touchStartY.current === null || 
      touchEndX.current === null || 
      touchEndY.current === null
    ) {
      return;
    }

    const diffX = touchStartX.current - touchEndX.current;
    const diffY = touchStartY.current - touchEndY.current;

    let visualDiffX = diffX; // positive means swipe left (finger right to left)
    let visualDiffY = diffY; // positive means swipe up (finger bottom to top)

    const isRotated = (isFullscreen || isPseudoFullscreen) && isMobilePortrait;
    if (isRotated) {
      // Rotate 90deg clockwise swaps and/or inverses the axis vectors
      // Physical swipe left (moving from physical right to physical left) visualizes as SWIPE UP
      // Physical swipe up (moving from physical bottom to physical top) visualizes as SWIPE LEFT
      visualDiffX = diffY;
      visualDiffY = diffX;
    }

    const minSwipeDistance = 45; // trigger distance in pixels

    if (Math.abs(visualDiffX) > Math.abs(visualDiffY)) {
      // Horizontal action
      if (Math.abs(visualDiffX) > minSwipeDistance) {
        if (visualDiffX > 0) {
          // Changed channel to next (swipe left)
          changeChannel('next');
        } else {
          // Changed channel to prev (swipe right)
          changeChannel('prev');
        }
      }
    } else {
      // Vertical action -> only intercept if in fullscreen/pseudo-fullscreen
      if (isFullscreen || isPseudoFullscreen) {
        if (Math.abs(visualDiffY) > minSwipeDistance) {
          if (visualDiffY > 0) {
            // Swiped up -> Open All Channels Panel
            playBeep('select');
            setIsFullscreenPanelOpen(true);
          }
        }
      }
    }

    // Reset touch variables
    touchStartX.current = null;
    touchStartY.current = null;
    touchEndX.current = null;
    touchEndY.current = null;
  };

  useEffect(() => {
    const checkOrientation = () => {
      const isMobile = window.innerWidth < 1024 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      const isPortrait = window.innerHeight > window.innerWidth;
      setIsMobilePortrait(isMobile && isPortrait);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  // Listen to first physical user interaction to unmute the video player
  useEffect(() => {
    const handleFirstInteraction = () => {
      setIsMuted(false);
      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.muted = false;
        videoEl.play().catch(() => {});
      }
    };
    document.body.addEventListener('click', handleFirstInteraction, { once: true, passive: true });
    document.body.addEventListener('keydown', handleFirstInteraction, { once: true, passive: true });
    document.body.addEventListener('pointerdown', handleFirstInteraction, { once: true, passive: true });
    return () => {
      document.body.removeEventListener('click', handleFirstInteraction);
      document.body.removeEventListener('keydown', handleFirstInteraction);
      document.body.removeEventListener('pointerdown', handleFirstInteraction);
    };
  }, []);

  const triggerControlsActivity = useCallback(() => {
    if (isLocked) {
      triggerLockNotice();
      return;
    }
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      window.clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = window.setTimeout(() => {
      const activeEl = document.activeElement;
      const isControlFocused = activeEl && (
        activeEl.id === 'playPauseBtn' || 
        activeEl.id === 'qualityBtn' || 
        activeEl.id === 'fsToggleBtn' || 
        activeEl.classList.contains('quality-opt-btn')
      );
      if (videoRef.current && !videoRef.current.paused && !showQualityMenu && !isControlFocused) {
        setShowControls(false);
      }
    }, 3500) as unknown as number;
  }, [showQualityMenu]);

  useEffect(() => {
    triggerControlsActivity();
    return () => {
      if (controlsTimeoutRef.current) {
        window.clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isPlaying, showQualityMenu, triggerControlsActivity]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const activeFS = !!document.fullscreenElement;
      setIsFullscreen(activeFS);
      if (!activeFS) {
        setIsPseudoFullscreen(false);
        if (screen.orientation && typeof (screen.orientation as any).unlock === 'function') {
          try {
            (screen.orientation as any).unlock();
          } catch (e) {
            console.log("Orientation unlock failed:", e);
          }
        }
      } else {
        if (screen.orientation && typeof (screen.orientation as any).lock === 'function') {
          try {
            (screen.orientation as any).lock('landscape').catch((e: any) => {
              console.log("Orientation lock failed:", e);
            });
          } catch (e) {
            console.log("Orientation lock failed:", e);
          }
        }
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Sync native iOS webkit fullscreen events
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const handleWebkitBeginFS = () => {
      setIsFullscreen(true);
    };

    const handleWebkitEndFS = () => {
      setIsFullscreen(false);
      setIsPseudoFullscreen(false);
    };

    videoEl.addEventListener('webkitbeginfullscreen', handleWebkitBeginFS);
    videoEl.addEventListener('webkitendfullscreen', handleWebkitEndFS);

    return () => {
      videoEl.removeEventListener('webkitbeginfullscreen', handleWebkitBeginFS);
      videoEl.removeEventListener('webkitendfullscreen', handleWebkitEndFS);
    };
  }, [videoRef]);

  // Sync state with browser history to intercept the device/browser back button
  useEffect(() => {
    const isAnyFsActive = isFullscreen || isPseudoFullscreen || isFullscreenPanelOpen;

    if (isAnyFsActive) {
      if (!hasPushedFsStateRef.current) {
        window.history.pushState({ fullscreenActive: true }, "");
        hasPushedFsStateRef.current = true;
      }
    } else {
      if (hasPushedFsStateRef.current) {
        hasPushedFsStateRef.current = false;
        if (window.history.state && window.history.state.fullscreenActive) {
          window.history.back();
        }
      }
    }
  }, [isFullscreen, isPseudoFullscreen, isFullscreenPanelOpen]);

  // Handle popstate event (device back button navigation)
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const isAnyFsActive = isFullscreen || isPseudoFullscreen || isFullscreenPanelOpen;
      
      if (isAnyFsActive) {
        // We intercepted back button, close all active fullscreen states!
        playBeep('select');
        
        if (isFullscreenPanelOpen) {
          setIsFullscreenPanelOpen(false);
        }
        
        if (isFullscreen) {
          if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => {});
          }
          setIsFullscreen(false);
        }
        
        if (isPseudoFullscreen) {
          setIsPseudoFullscreen(false);
        }
        
        hasPushedFsStateRef.current = false;
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isFullscreen, isPseudoFullscreen, isFullscreenPanelOpen, setIsFullscreenPanelOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      const isInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
      const isTVBackKey = e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack' || e.key === 'GoBack';

      // Wake up the player controls on arrow keys, enter, space, escape, backspace, and select
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Select'].includes(e.key) || isTVBackKey) {
        triggerControlsActivity();
      }

      // Back action via Backspace, Escape, BrowserBack, or GoBack
      if (isTVBackKey && !isInput) {
        if (isFullscreenPanelOpen) {
          e.preventDefault();
          playBeep('select');
          setIsFullscreenPanelOpen(false);
          return;
        }

        if (isFullscreen || isPseudoFullscreen) {
          e.preventDefault();
          playBeep('select');
          if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => {});
          }
          setIsFullscreen(false);
          setIsPseudoFullscreen(false);
          return;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen, isPseudoFullscreen, isFullscreenPanelOpen, setIsFullscreenPanelOpen, triggerControlsActivity]);

  useEffect(() => {
    onVideoRef(videoRef.current);
    return () => {
      onVideoRef(null);
    };
  }, [onVideoRef]);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl) {
      videoEl.volume = volume;
      videoEl.muted = isMuted;
    }
  }, [volume, isMuted, cleanUrl]);

  // Clean and start streaming whenever channel url, reloadTrigger, useProxy, or forceNative setup changes
  useEffect(() => {
    if (!cleanUrl) return;
    
    // Resolve unencrypted HTTP urls through corporate stream proxy to prevent Mixed Content security restrictions.
    // For other HTTPS streams, use defined proxy settings
    const playbackUrl = useProxy 
      ? `${window.location.origin}/api/stream-proxy?url=${encodeURIComponent(cleanUrl)}` 
      : cleanUrl;

    // Reset previous states
    setRetryCount(0);
    setStatusMessage('');
    setHasQualityLevels(false);
    setIsBuffering(true);

    const videoEl = videoRef.current;
    if (!videoEl) return;

    // Destroy duplicate/old hls logic with advanced memory-leak prevention
    if (hlsRef.current) {
      try {
        hlsRef.current.stopLoad();
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
      } catch (err) {
        console.warn("Hls cleanup error:", err);
      }
      hlsRef.current = null;
    }

    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();

    const loadStream = () => {
      // 1. Native HLS support check (mainly Safari, iOS, or when Tizen/webOS systems are forced)
      if (forceNative || videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = playbackUrl;
        videoEl.play().catch(err => {
          if (err.name !== "NotAllowedError" && err.name !== "AbortError") {
            console.warn("Playback interrupted or delayed:", err);
          }
        });
      } 
      // 2. Play using hls.js (standard browser)
      else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startFragPrefetch: true,
          testBandwidth: true,
          fragLoadingMaxRetry: 6,
          manifestLoadingMaxRetry: 6,
          liveSyncDurationCount: 3,
        });

        hlsRef.current = hls;
        hls.loadSource(playbackUrl);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          const levels = hls.levels;
          if (levels && levels.length > 1) {
            setHasQualityLevels(true);
            applyQualityToHls(hls, playbackQuality, levels.length);
          } else {
            setHasQualityLevels(false);
          }
          videoEl.play().catch(() => {
            // Mute and overlay play trigger if browser blocks autoplay
            videoEl.muted = true;
            videoEl.play().catch(err => console.warn("Muted autoplay blocked:", err));
          });
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.warn(`HLS fatal error encountered: ${data.type} - ${data.details}`);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              // Level 1 Recovery: soft load-start first if possible
              try {
                hls.startLoad();
              } catch (_) {}

              // Level 2 Recovery: rebuild stream with persistent retries
              setRetryCount(prev => {
                const updated = prev + 1;
                if (updated <= 2) {
                  setStatusMessage(`⚠️ Connecting... Retry ${updated}/2...`);
                  setTimeout(() => {
                    if (hlsRef.current === hls) {
                      loadStream();
                    }
                  }, 2000);
                } else {
                  // Fall back automatically on network error
                  triggerAlternateRouteFallback();
                }
                return updated;
              });
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              try {
                hls.recoverMediaError();
              } catch (err) {
                loadStream();
              }
            } else {
              setRetryCount(prev => {
                const updated = prev + 1;
                if (updated <= 2) {
                  setStatusMessage(`⚠️ Reconnecting... Retry ${updated}/2...`);
                  setTimeout(() => {
                    if (hlsRef.current === hls) {
                      loadStream();
                    }
                  }, 1500);
                } else {
                  triggerAlternateRouteFallback();
                }
                return updated;
              });
            }
          }
        });
      } else {
        // Fallback natively to source element
        videoEl.src = playbackUrl;
        videoEl.play().catch(() => {
          setStatusMessage("❌ HLS is not supported in this browser.");
        });
      }
    };

    loadStream();

    return () => {
      if (hlsRef.current) {
        try {
          hlsRef.current.stopLoad();
          hlsRef.current.detachMedia();
          hlsRef.current.destroy();
        } catch (err) {
          console.warn("Hls unmount cleanup error:", err);
        }
        hlsRef.current = null;
      }
    };
  }, [cleanUrl, reloadTrigger, useProxy, forceNative, triggerAlternateRouteFallback]);

  // Automated Watchdog to prevent permanent freeze/black screen on unstable live sports feeds
  useEffect(() => {
    if (!cleanUrl) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    let lastTime = videoEl.currentTime;
    let staleCount = 0;

    const interval = setInterval(() => {
      // Only watch for stalls if the video is actively playing, has loaded data (readyState >= 2), and has started playback timeline progression (currentTime > 0)
      if (videoEl.paused || videoEl.readyState < 2 || videoEl.currentTime === 0) {
        staleCount = 0;
        lastTime = videoEl.currentTime;
        return;
      }

      const currentTime = videoEl.currentTime;
      // If the video timeline doesn't advance or advances less than 15 milliseconds in 3 seconds
      if (Math.abs(currentTime - lastTime) < 0.015) {
        staleCount++;
        // If it is stuck for 2 checks (approx 6 seconds total), trigger self-healing recovery!
        if (staleCount >= 2) {
          console.warn("⚠️ Stream timeline frozen or stalled. Initiating auto-recovery...");
          
          if (Hls.isSupported() && hlsRef.current) {
            try {
              hlsRef.current.stopLoad();
              hlsRef.current.startLoad();
              
              if (videoEl.buffered.length > 0) {
                const bufferEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
                // Seek to 1.5 seconds behind the live limit
                videoEl.currentTime = Math.max(0, bufferEnd - 1.5);
              } else {
                hlsRef.current.recoverMediaError();
              }
              videoEl.play().catch(() => {});
            } catch (err) {
              try {
                const isHttp = cleanUrl.startsWith('http://');
                const playbackUrl = isHttp 
                  ? `${window.location.origin}/api/stream-proxy?url=${encodeURIComponent(cleanUrl)}` 
                  : cleanUrl;
                hlsRef.current.loadSource(playbackUrl);
                videoEl.play().catch(() => {});
              } catch (_) {}
            }
          } else {
            // For native systems, toggle video source or reload inline
            try {
              const prevSrc = videoEl.src;
              videoEl.src = '';
              videoEl.src = prevSrc;
              videoEl.load();
              videoEl.play().catch(() => {});
            } catch (err) {
              console.error("Native watchdog auto-recovery failed:", err);
            }
          }
          staleCount = 0;
        }
      } else {
        staleCount = 0;
      }
      lastTime = currentTime;
    }, 3000);

    return () => clearInterval(interval);
  }, [cleanUrl, reloadTrigger]);

  // Apply playback quality changes to active HLS container
  useEffect(() => {
    const hls = hlsRef.current;
    if (hls && hls.levels && hls.levels.length > 1) {
      applyQualityToHls(hls, playbackQuality, hls.levels.length);
    }
  }, [playbackQuality]);

  const applyQualityToHls = (hls: Hls, quality: PlaybackQuality, levelsCount: number) => {
    try {
      if (quality === 'auto') {
        hls.autoLevelCapping = -1;
        hls.currentLevel = -1;
        hls.nextLevel = -1;
        hls.loadLevel = -1;
      } else {
        let targetLevel = -1;
        if (quality === 'high') {
          targetLevel = levelsCount - 1;
        } else if (quality === 'medium') {
          targetLevel = Math.max(0, Math.floor(levelsCount * 0.6));
        } else if (quality === 'low') {
          targetLevel = Math.max(0, Math.floor(levelsCount * 0.3));
        }

        if (targetLevel >= 0 && targetLevel < levelsCount) {
          // Force override on all level controls to switch immediately and lock the quality
          hls.currentLevel = targetLevel;
          hls.nextLevel = targetLevel;
          hls.loadLevel = targetLevel;
        }
      }
    } catch (err) {
      console.error("Error applying quality level:", err);
    }
  };

  const selectQuality = (q: PlaybackQuality) => {
    playBeep('select');
    setPlaybackQuality(q);
    setShowQualityMenu(false);
  };

  const togglePlay = () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    playBeep('select');
    if (videoEl.paused) {
      videoEl.play().catch(err => console.warn("Play trigger delayed:", err));
      setIsPlaying(true);
    } else {
      videoEl.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    playBeep('select');
    const nextMuted = !isMuted;
    videoEl.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const toggleFullscreen = () => {
    playBeep('select');
    const container = document.getElementById('videoPlayerOuterContainer');
    if (!container) return;
    const videoEl = videoRef.current;

    if (!document.fullscreenElement && !isPseudoFullscreen) {
      // 1. Try standard Element.requestFullscreen() first (Android / Desktop)
      if (container.requestFullscreen) {
        container.requestFullscreen()
          .then(() => {
            setIsFullscreen(true);
            if (screen.orientation && typeof (screen.orientation as any).lock === 'function') {
              try {
                (screen.orientation as any).lock('landscape').catch(() => {});
              } catch (e) {}
            }
          })
          .catch(() => {
            // Fallback to video fullscreen
            if (videoEl) {
              if (typeof (videoEl as any).webkitEnterFullscreen === 'function') {
                try {
                  (videoEl as any).webkitEnterFullscreen();
                  setIsFullscreen(true);
                } catch (err) {
                  setIsPseudoFullscreen(true);
                }
              } else {
                (videoEl as any).webkitRequestFullscreen?.() || videoEl.requestFullscreen?.();
              }
            }
          });
        // Enable pseudo-fullscreen as fallback state while entering FS
        setIsPseudoFullscreen(true);
      } 
      // 2. iOS specific check: webkitEnterFullscreen (iPhones)
      else if (videoEl && typeof (videoEl as any).webkitEnterFullscreen === 'function') {
        try {
          (videoEl as any).webkitEnterFullscreen();
          setIsFullscreen(true);
        } catch (err) {
          console.warn("webkitEnterFullscreen failed, falling back to pseudo-fullscreen:", err);
          setIsPseudoFullscreen(true);
        }
      } 
      // 3. Fallback to pseudo-fullscreen for any other browser
      else {
        setIsPseudoFullscreen(true);
      }

      // Attempt immediate lock for devices supporting orientation locks
      if (screen.orientation && typeof (screen.orientation as any).lock === 'function') {
        try {
          (screen.orientation as any).lock('landscape').catch(() => {});
        } catch (e) {}
      }
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      } else if (videoEl && typeof (videoEl as any).webkitExitFullscreen === 'function') {
        try {
          (videoEl as any).webkitExitFullscreen();
        } catch (e) {}
      }
      
      if (screen.orientation && typeof (screen.orientation as any).unlock === 'function') {
        try {
          (screen.orientation as any).unlock();
        } catch (e) {}
      }
      setIsFullscreen(false);
      setIsPseudoFullscreen(false);
    }
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const targetTime = parseFloat(e.target.value);
    videoEl.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const isLive = !isFinite(duration) || duration === 0;
  const percent = duration > 0 ? (currentTime / duration) * 100 : 100;

  return (
    <section className="bg-transparent flex justify-center py-1.5 px-4 select-none">
      <div 
        id="videoPlayerOuterContainer"
        onContextMenu={(e) => e.preventDefault()}
        className={`w-full max-w-sm sm:max-w-md md:max-w-xl lg:max-w-[640px] bg-slate-950/85 rounded-2xl p-1 shadow-2xl relative border border-slate-800/50 transition-all duration-300 ${
          isFullscreen || isPseudoFullscreen 
            ? isMobilePortrait
              ? 'fixed z-[100] top-1/2 left-1/2 origin-center shadow-2xl overflow-hidden'
              : '!max-w-none !p-0 !border-0 !rounded-none fixed inset-0 z-[100] w-screen h-screen' 
            : ''
        }`}
        style={
          (isFullscreen || isPseudoFullscreen) && isMobilePortrait
            ? {
                width: '100vh',
                height: '100vw',
                transform: 'translate(-50%, -50%) rotate(90deg)',
              }
            : undefined
        }
      >
        <div 
          id="videoContainer" 
          onContextMenu={(e) => e.preventDefault()}
          className={`rounded-xl overflow-hidden aspect-video bg-black relative group/player w-full h-full transition-all duration-300 ${
            isFullscreen || isPseudoFullscreen ? '!rounded-none !aspect-none' : ''
          }`}
          onMouseMove={triggerControlsActivity}
          onMouseLeave={() => isPlaying && setShowControls(false)}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Main Video Element */}
          <video
            id="liveVideo"
            ref={videoRef}
            onContextMenu={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
            controls={false}
            autoPlay
            playsInline
            muted={isMuted}
            onError={handleVideoError}
            onClick={triggerControlsActivity}
            onPlay={() => {
              setIsPlaying(true);
              setIsBuffering(false);
            }}
            onPause={(e) => {
              setIsPlaying(false);
              const videoEl = e.currentTarget;
              if (videoEl) {
                // Instantly trigger recovery play / reload within a few milliseconds
                setTimeout(() => {
                  if (videoEl.paused) {
                    console.log("⚡ Auto Play/Reload triggered on pause event to resume live stream instantly.");
                    videoEl.play()
                      .then(() => {
                        setIsPlaying(true);
                      })
                      .catch((err) => {
                        console.warn("⚠️ Play call blocked or failed. Performing force reload...", err);
                        // Force a fresh reload of the current streaming instance to heal the playback pipeline
                        try {
                          if (Hls.isSupported() && hlsRef.current && !forceNative) {
                            hlsRef.current.stopLoad();
                            hlsRef.current.startLoad();
                            if (videoEl.buffered.length > 0) {
                              const bufferEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
                              videoEl.currentTime = Math.max(0, bufferEnd - 0.5);
                            } else {
                              hlsRef.current.recoverMediaError();
                            }
                            videoEl.play().catch(() => {});
                          } else {
                            const prevSrc = videoEl.src;
                            videoEl.src = '';
                            videoEl.load();
                            videoEl.src = prevSrc;
                            videoEl.load();
                            videoEl.play().catch(() => {});
                          }
                          setIsPlaying(true);
                        } catch (err2) {
                          console.error("Auto-reload recovery failed:", err2);
                        }
                      });
                  }
                }, 50); // Action completes within standard 50ms frame threshold
              }
            }}
            onPlaying={() => setIsBuffering(false)}
            onWaiting={() => setIsBuffering(true)}
            onSeeking={() => setIsBuffering(true)}
            onSeeked={() => setIsBuffering(false)}
            onLoadStart={() => setIsBuffering(true)}
            onLoadedData={() => setIsBuffering(false)}
            onCanPlay={() => setIsBuffering(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
            onVolumeChange={(e) => setIsMuted(e.currentTarget.muted)}
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration || 0);
              setIsMuted(e.currentTarget.muted);
              setIsPlaying(!e.currentTarget.paused);
              setIsBuffering(false);
            }}
            className={`w-full h-full block transition-all duration-500 ${
              zoomMode === 'cover' ? 'object-cover scale-102' : zoomMode === 'fill' ? 'object-fill' : 'object-contain'
            }`}
            poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3Crect width='100%25' height='100%25' fill='%23000'/%3E%3C/svg%3E"
          />

          {/* Zoom Mode Display Notification Overlay */}
          {zoomNotification && (
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-slate-900/95 border border-white/25 px-4 py-1.5 rounded-full text-white text-xs font-bold pointer-events-none z-40 animate-fade-in flex items-center gap-2 shadow-[0_4px_16px_rgba(0,0,0,0.6)] backdrop-blur-sm">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="font-sans tracking-wide uppercase text-[10px]">Zoom: {zoomNotification}</span>
            </div>
          )}

          {/* Centered Buffering/Loading Overlay with "TV" display */}
          {cleanUrl && isBuffering && !hasError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 pointer-events-none select-none z-20 transition-opacity duration-300">
              <div className="relative flex flex-col items-center justify-center">
                {/* Double ring effects */}
                <div className="absolute w-24 h-24 rounded-full border border-blue-500/20 animate-ping opacity-60" />
                <div className="absolute w-20 h-20 rounded-full border-4 border-t-blue-400 border-r-transparent border-b-blue-400 border-l-transparent animate-spin duration-1000 opacity-80" />
                
                {/* Beautiful container with Tv icon */}
                <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.3)]">
                  <Tv className="w-8 h-8 text-blue-400 animate-pulse" strokeWidth={2.5} />
                </div>
              </div>
            </div>
          )}

          {/* Centered Play Button when paused */}
          {!isPlaying && (
            <div 
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="absolute inset-0 flex items-center justify-center bg-black/20 cursor-pointer transition-all duration-300 z-10"
            >
              <div className="w-14 h-14 rounded-full bg-white/95 flex items-center justify-center shadow-xl transform transition-transform duration-300 hover:scale-110">
                <Play className="w-5 h-5 text-black fill-black ml-1" />
              </div>
            </div>
          )}

          {/* Custom Controls Bar matching image */}
          <div 
            className={`absolute bottom-0 inset-x-0 bg-transparent px-3.5 py-2 flex items-center justify-between gap-3 md:gap-4 transition-all duration-300 z-20 ${
              showControls ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0 pointer-events-none'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Play/Pause control option */}
            <button
              id="playPauseBtn"
              onClick={togglePlay}
              onFocus={() => {
                setShowControls(true);
                if (controlsTimeoutRef.current) {
                  window.clearTimeout(controlsTimeoutRef.current);
                  controlsTimeoutRef.current = null;
                }
              }}
              onBlur={() => {
                triggerControlsActivity();
              }}
              className="text-white hover:text-slate-200 cursor-pointer p-1 transition-colors outline-hidden flex-none"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-white text-white hover:fill-slate-200 hover:text-slate-200 transition-colors" />
              ) : (
                <Play className="w-4 h-4 fill-white text-white hover:fill-slate-200 hover:text-slate-200 transition-colors" />
              )}
            </button>

            {/* Premium Lock Button replacing the Live Stream text indicator */}
            <div className="flex-1 flex items-center justify-start pl-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playBeep('select');
                  setIsLocked(true);
                  setShowControls(false);
                }}
                className="flex items-center justify-center p-2 rounded-xl bg-transparent hover:bg-white/10 active:bg-white/20 active:scale-95 transition-all text-white cursor-pointer border border-transparent"
                title="Lock Display Controls"
              >
                <Lock className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Right side group icons: Volume, Gear settings, Fullscreen */}
            <div className="flex items-center gap-2.5 md:gap-3 flex-none relative">
              {/* Volume Controller with interactive sound slider */}
              <div className="flex items-center gap-1 bg-transparent px-1 py-0.5 rounded-lg border border-transparent">
                <button
                  onClick={toggleMute}
                  className="text-white hover:text-slate-200 cursor-pointer p-1 transition-colors outline-hidden flex justify-center items-center"
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setVolume(val);
                    if (val > 0) {
                      setIsMuted(false);
                    } else {
                      setIsMuted(true);
                    }
                  }}
                  className="w-12 sm:w-16 h-1 accent-white bg-slate-850 rounded-full appearance-none cursor-pointer focus:outline-hidden"
                  style={{
                    background: `linear-gradient(to right, #ffffff 0%, #ffffff ${(isMuted ? 0 : volume) * 100}%, #334155 ${(isMuted ? 0 : volume) * 100}%, #334155 100%)`,
                  }}
                  title="Volume"
                />
              </div>

              {/* Quality Settings (Using qualityBtn trigger for TV Spatial System compatibility) */}
              <div className="relative">
                <button
                  id="qualityBtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    playBeep('select');
                    setShowQualityMenu(!showQualityMenu);
                  }}
                  onFocus={() => {
                    setShowControls(true);
                    if (controlsTimeoutRef.current) {
                      window.clearTimeout(controlsTimeoutRef.current);
                      controlsTimeoutRef.current = null;
                    }
                  }}
                  onBlur={() => {
                    triggerControlsActivity();
                  }}
                  className={`text-white hover:text-slate-200 cursor-pointer p-1 transition-colors outline-hidden flex justify-center items-center ${
                    showQualityMenu ? 'text-slate-200' : ''
                  }`}
                  title="Quality Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>

                {/* Popover options list */}
                {showQualityMenu && (
                  <div 
                    id="qualityMenu"
                    className="absolute bottom-9 right-0 bg-slate-900 border border-white/20 rounded-xl py-2 w-48 shadow-2xl flex flex-col z-50 animate-fade-in text-left select-none"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-3 py-1 text-[9px] text-slate-400 uppercase font-bold tracking-wider border-b border-slate-800">
                      Quality / গুণমান
                    </div>
                    {(['auto', 'high', 'medium', 'low'] as PlaybackQuality[]).map((q) => (
                      <button
                        key={q}
                        onClick={() => {
                          playBeep('select');
                          selectQuality(q);
                        }}
                        tabIndex={0}
                        onFocus={() => {
                          setShowControls(true);
                          if (controlsTimeoutRef.current) {
                            window.clearTimeout(controlsTimeoutRef.current);
                            controlsTimeoutRef.current = null;
                          }
                        }}
                        onBlur={() => {
                          triggerControlsActivity();
                        }}
                        className={`quality-opt-btn px-3 py-1.5 text-left text-[11px] hover:bg-white hover:text-slate-950 transition-colors cursor-pointer outline-hidden flex justify-between items-center ${
                          playbackQuality === q ? 'bg-white/10 text-white font-bold' : 'text-slate-300'
                        }`}
                      >
                        <span>{q.toUpperCase()}</span>
                        {playbackQuality === q && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                      </button>
                    ))}

                    <div className="mt-2 px-3 py-1 text-[9px] text-slate-400 uppercase font-bold tracking-wider border-t border-b border-slate-800">
                      Route / সার্ভার অপশন
                    </div>
                    
                    {/* Direct stream playback */}
                    <button
                      onClick={() => {
                        playBeep('select');
                        setUseProxy(false);
                        setForceNative(false);
                      }}
                      tabIndex={0}
                      className={`quality-opt-btn px-3 py-1.5 text-left text-[11px] hover:bg-white hover:text-slate-950 transition-colors cursor-pointer outline-hidden flex justify-between items-center ${
                        !useProxy && !forceNative ? 'bg-white/10 text-white font-bold' : 'text-slate-300'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span>Direct (Local ISP)</span>
                        <span className="text-[8px] text-slate-400">ডাইরেক্ট প্লে (মোবাইল/টিভি)</span>
                      </div>
                      {!useProxy && !forceNative && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                    </button>

                    {/* Server stream proxying */}
                    <button
                      onClick={() => {
                        playBeep('select');
                        setUseProxy(true);
                        setForceNative(false);
                      }}
                      tabIndex={0}
                      className={`quality-opt-btn px-3 py-1.5 text-left text-[11px] hover:bg-white hover:text-slate-950 transition-colors cursor-pointer outline-hidden flex justify-between items-center ${
                        useProxy ? 'bg-white/10 text-white font-bold' : 'text-slate-300'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span>Server Proxy Route</span>
                        <span className="text-[8px] text-slate-400">সার্ভার প্রক্সি রুট</span>
                      </div>
                      {useProxy && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                    </button>

                    {/* Force Native HTML5 HLS engine */}
                    <button
                      onClick={() => {
                        playBeep('select');
                        setUseProxy(false);
                        setForceNative(true);
                      }}
                      tabIndex={0}
                      className={`quality-opt-btn px-3 py-1.5 text-left text-[11px] hover:bg-white hover:text-slate-950 transition-colors cursor-pointer outline-hidden flex justify-between items-center ${
                        !useProxy && forceNative ? 'bg-white/10 text-white font-bold' : 'text-slate-300'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span>Force Native TV Player</span>
                        <span className="text-[8px] text-slate-400">টিভি ব্লকার বাইপাস</span>
                      </div>
                      {!useProxy && forceNative && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
                    </button>
                  </div>
                )}
              </div>

              {/* Zoom aspect ratio toggle */}
              <button
                id="zoomToggleBtn"
                onClick={cycleZoomMode}
                onFocus={() => {
                  setShowControls(true);
                  if (controlsTimeoutRef.current) {
                    window.clearTimeout(controlsTimeoutRef.current);
                    controlsTimeoutRef.current = null;
                  }
                }}
                onBlur={() => {
                  triggerControlsActivity();
                }}
                className="text-white hover:text-slate-200 hover:scale-115 active:scale-95 transition-all cursor-pointer p-1.5 flex justify-center items-center rounded-lg bg-transparent hover:bg-white/10 select-none border border-transparent gap-1"
                title="Zoom Mode / ভিডিও জুম"
              >
                <Expand className="w-4 h-4 text-white" />
                <span className="text-[9px] font-extrabold tracking-wider uppercase bg-white/10 border border-white/5 px-1 py-0.5 rounded text-slate-100">
                  {zoomMode === 'contain' ? 'Fit' : zoomMode === 'cover' ? 'Zoom' : 'Stretch'}
                </span>
              </button>

              {/* Toggle fullscreen */}
              <button
                id="fsToggleBtn"
                onClick={toggleFullscreen}
                onFocus={() => {
                  setShowControls(true);
                  if (controlsTimeoutRef.current) {
                    window.clearTimeout(controlsTimeoutRef.current);
                    controlsTimeoutRef.current = null;
                  }
                }}
                onBlur={() => {
                  triggerControlsActivity();
                }}
                className="text-white hover:text-slate-200 hover:scale-115 active:scale-95 transition-all cursor-pointer p-1.5 flex justify-center items-center rounded-lg bg-transparent hover:bg-white/10 select-none border border-transparent"
                title="Toggle Fullscreen"
              >
                {isFullscreen || isPseudoFullscreen ? (
                  <svg className="w-5.5 h-5.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 4v4H4" />
                    <path d="M16 4v4h4" />
                    <path d="M16 20v-4h4" />
                    <path d="M8 20v-4H4" />
                  </svg>
                ) : (
                  <svg className="w-5.5 h-5.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 8V4h4" />
                    <path d="M16 4h4v4" />
                    <path d="M16 20h4v-4" />
                    <path d="M4 16v4h4" />
                  </svg>
                )}
              </button>
            </div>
          </div>



          {/* Lock Screen Overlay (Only shown when screen is locked) */}
          {isLocked && (
            <div 
              onClick={(e) => {
                e.stopPropagation();
                triggerLockNotice();
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                triggerLockNotice();
              }}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              className="absolute inset-0 bg-transparent z-50 pointer-events-auto select-none flex items-end justify-start p-4 sm:p-6"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playBeep('select');
                  setIsLocked(false);
                  setShowControls(true);
                }}
                className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-slate-900/90 text-white flex items-center justify-center shadow-2xl border border-white/20 hover:border-white active:scale-90 transition-all duration-300 pointer-events-auto cursor-pointer focus-visible:outline-hidden ${
                  showLockFeedback ? 'scale-115 bg-slate-850 ring-4 ring-white/30 border-white rotate-12' : 'scale-100'
                }`}
                title="Tap to Unlock display"
              >
                <Lock className="w-5.5 h-5.5 text-white fill-white/10 animate-pulse" />
              </button>
            </div>
          )}

          {/* Embedded FullscreenChannelPanel that is DOM-scoped inside #videoContainer */}
          <FullscreenChannelPanel
            isOpen={isFullscreenPanelOpen}
            onClose={() => setIsFullscreenPanelOpen(false)}
            filteredChannels={filteredChannels}
            activeChannelUrl={activeChannelUrl}
            onSelectChannel={onSelectChannel}
            fsCategory={fsCategory}
            setFsCategory={setFsCategory}
          />
        </div>
      </div>
    </section>
  );
};
