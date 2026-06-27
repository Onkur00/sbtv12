/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Link2, 
  Upload, 
  PlusCircle, 
  Check, 
  Trash2, 
  Tv, 
  FolderOpen, 
  Sparkles, 
  Play, 
  FileText,
  AlertCircle
} from 'lucide-react';
import { EnhancedChannel } from '../types.ts';
import { parseM3U } from '../utils/m3uParser.ts';
import { playBeep } from '../utils/beep.ts';

interface PlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlaylistLoaded: (channels: EnhancedChannel[], playlistName: string) => void;
  onSelectDefaultPlaylist: () => void;
  activePlaylistName: string;
}

interface SavedPlaylist {
  name: string;
  channelsCount: number;
  channels: EnhancedChannel[];
  timestamp: number;
}

export const PlaylistModal: React.FC<PlaylistModalProps> = ({
  isOpen,
  onClose,
  onPlaylistLoaded,
  onSelectDefaultPlaylist,
  activePlaylistName,
}) => {
  const [activeTab, setActiveTab] = useState<'url' | 'file' | 'add_single' | 'saved'>('url');
  
  // URL load states
  const [playlistUrl, setPlaylistUrl] = useState<string>('');
  const [playlistNameUrl, setPlaylistNameUrl] = useState<string>('My Custom Link');
  const [isLoadingUrl, setIsLoadingUrl] = useState<boolean>(false);
  const [errorUrl, setErrorUrl] = useState<string>('');

  // File load states
  const [fileContent, setFileContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [errorFile, setErrorFile] = useState<string>('');

  // Single channel load states
  const [chName, setChName] = useState<string>('');
  const [chUrl, setChUrl] = useState<string>('');
  const [chGroup, setChGroup] = useState<string>('Custom');
  const [chLogo, setChLogo] = useState<string>('');
  const [errorSingle, setErrorSingle] = useState<string>('');

  // Saved playlists list state
  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylist[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load saved playlists from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('iptv_saved_playlists');
    if (saved) {
      try {
        setSavedPlaylists(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved playlists", e);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const savePlaylistToLocalStorage = (name: string, channels: EnhancedChannel[]) => {
    const newPlaylist: SavedPlaylist = {
      name,
      channelsCount: channels.length,
      channels,
      timestamp: Date.now()
    };
    
    const updated = [newPlaylist, ...savedPlaylists.filter(p => p.name !== name)].slice(0, 10);
    setSavedPlaylists(updated);
    localStorage.setItem('iptv_saved_playlists', JSON.stringify(updated));
  };

  const deletePlaylist = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    playBeep('select');
    const updated = savedPlaylists.filter(p => p.name !== name);
    setSavedPlaylists(updated);
    localStorage.setItem('iptv_saved_playlists', JSON.stringify(updated));
    
    if (activePlaylistName === name) {
      onSelectDefaultPlaylist();
    }
  };

  // 1. M3U URL Loader
  const handleLoadUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    playBeep('select');
    setErrorUrl('');
    
    if (!playlistUrl.trim()) {
      setErrorUrl('Please enter a valid playlist URL / অনুগ্রহ করে ইউআরএল দিন।');
      return;
    }

    setIsLoadingUrl(true);
    try {
      // Use the robust cascading proxy to bypass CORS
      const proxyUrl = `/api/stream-proxy?url=${encodeURIComponent(playlistUrl.trim())}`;
      const response = await fetch(proxyUrl);
      
      if (!response.ok) {
        throw new Error(`Server returned status: ${response.status}`);
      }

      const text = await response.text();
      const parsedChannels = parseM3U(text);
      if (parsedChannels.length === 0) {
        throw new Error('No valid streams were parsed from this M3U URL. কোনো চ্যানেল পাওয়া যায়নি।');
      }

      const playlistTitle = playlistNameUrl.trim() || 'Custom Playlist';
      savePlaylistToLocalStorage(playlistTitle, parsedChannels);
      onPlaylistLoaded(parsedChannels, playlistTitle);
      
      // Reset inputs
      setPlaylistUrl('');
      setPlaylistNameUrl('My Custom Link');
      onClose();
    } catch (err: any) {
      console.error(err);
      setErrorUrl(err.message || 'Failed to fetch. CORS block or invalid URL? অনুগ্রহ করে সরাসরি ফাইল আপলোড ট্রাই করুন।');
    } finally {
      setIsLoadingUrl(false);
    }
  };

  // 2. M3U File Loader
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const parsed = parseM3U(content);
      if (parsed.length === 0) {
        setErrorFile('No active channels found in this file! কোনো সচল চ্যানেল বা ভিডিও লিঙ্ক সনাক্ত করা যায়নি।');
        return;
      }

      const nameWithoutExtension = file.name.replace(/\.[^/.]+$/, "");
      savePlaylistToLocalStorage(nameWithoutExtension, parsed);
      onPlaylistLoaded(parsed, nameWithoutExtension);
      onClose();
    };
    reader.readAsText(file);
  };

  // Drag-and-drop mechanics
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // 3. Add Single Stream
  const handleAddSingleChannel = (e: React.FormEvent) => {
    e.preventDefault();
    playBeep('select');
    setErrorSingle('');

    if (!chName.trim() || !chUrl.trim()) {
      setErrorSingle('Name and URL are required field. নাম এবং ইউআরএল আবশ্যক।');
      return;
    }

    const newChannel: EnhancedChannel = {
      id: `manual-ch-${Date.now()}`,
      name: chName.trim(),
      short: chName.trim().split(' ')[0],
      url: chUrl.trim(),
      category: chGroup.trim().toLowerCase() || 'custom',
      logoUrl: chLogo.trim(),
      groupTitle: chGroup.trim() || 'Custom',
      original: {
        tvgId: `manual-ch-${Date.now()}`,
        tvgName: chName.trim(),
        tvgLogo: chLogo.trim(),
        groupTitle: chGroup.trim(),
        url: chUrl.trim()
      }
    };

    // Let's load existing "My Custom Channels" or start a new playlist
    const customPlaylistName = "Manual Streams";
    const existing = savedPlaylists.find(p => p.name === customPlaylistName);
    const updatedChannels = existing ? [...existing.channels, newChannel] : [newChannel];

    savePlaylistToLocalStorage(customPlaylistName, updatedChannels);
    onPlaylistLoaded(updatedChannels, customPlaylistName);

    // Reset inputs
    setChName('');
    setChUrl('');
    setChGroup('Custom');
    setChLogo('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        onClick={() => {
          playBeep('select');
          onClose();
        }}
      />
      
      {/* Modal Card */}
      <div className="relative w-full max-w-lg bg-slate-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] z-10 animate-scale-up">
        
        {/* Header */}
        <div className="px-6 py-4.5 border-b border-white/5 flex items-center justify-between bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-yellow-400">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-white tracking-wide">
                IPTV Playlist Manager
              </h2>
              <p className="text-[10px] text-slate-400 font-medium">প্লেলিস্ট লোড করে চ্যানেলগুলো প্লে করুন</p>
            </div>
          </div>
          <button 
            onClick={() => {
              playBeep('select');
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 border border-white/5 flex items-center justify-center text-slate-300 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Custom Tab Bar Selector */}
        <div className="px-5 py-2.5 bg-slate-950/20 border-b border-white/5 flex gap-1 overflow-x-auto scrollbar-none shrink-0">
          <button
            onClick={() => { playBeep('select'); setActiveTab('url'); }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
              activeTab === 'url' ? 'bg-yellow-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>M3U Link</span>
          </button>
          
          <button
            onClick={() => { playBeep('select'); setActiveTab('file'); }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
              activeTab === 'file' ? 'bg-yellow-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>M3U File</span>
          </button>

          <button
            onClick={() => { playBeep('select'); setActiveTab('add_single'); }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
              activeTab === 'add_single' ? 'bg-yellow-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Add Stream</span>
          </button>

          <button
            onClick={() => { playBeep('select'); setActiveTab('saved'); }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer relative ${
              activeTab === 'saved' ? 'bg-yellow-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Saved List</span>
            {savedPlaylists.length > 0 && (
              <span className="absolute -top-1 -right-1.5 bg-red-500 text-white text-[8px] font-bold h-4 min-w-4 px-1 rounded-full flex items-center justify-center border border-slate-900 animate-bounce">
                {savedPlaylists.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab Contents - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          
          {/* TAB 1: M3U Link URL */}
          {activeTab === 'url' && (
            <form onSubmit={handleLoadUrl} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider ml-1">Playlist Name (প্লেলিস্টের নাম)</label>
                <input
                  type="text"
                  value={playlistNameUrl}
                  onChange={(e) => setPlaylistNameUrl(e.target.value)}
                  placeholder="যেমন: My Sports Link"
                  className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-hidden focus:ring-2 focus:ring-yellow-500/30 focus:border-yellow-500/50 transition-all font-sans"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider ml-1">M3U Playlist Link (ইউআরএল)</label>
                <input
                  type="url"
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  placeholder="https://example.com/playlist.m3u"
                  className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-hidden focus:ring-2 focus:ring-yellow-500/30 focus:border-yellow-500/50 transition-all font-sans"
                />
              </div>

              {errorUrl && (
                <div className="text-amber-500 text-[11px] font-bold flex items-center gap-1.5 px-1">
                  <AlertCircle className="w-4 h-4" />
                  <span>{errorUrl}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoadingUrl}
                className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-extrabold py-2.5 rounded-xl text-xs tracking-wider transition-all shadow-md active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5"
              >
                {isLoadingUrl ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>ফাইল প্রসেস হচ্ছে...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 animate-pulse" />
                    <span>প্লেলিস্ট লোড করুন (Load)</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* TAB 2: File Upload */}
          {activeTab === 'file' && (
            <div className="space-y-4">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => {
                  playBeep('select');
                  fileInputRef.current?.click();
                }}
                className={`border-2 border-dashed rounded-3xl p-8 flex flex-col items-center text-center gap-3 cursor-pointer transition-all ${
                  isDragOver 
                    ? 'border-yellow-500 bg-yellow-500/5' 
                    : 'border-white/10 hover:border-white/30 bg-slate-950/20'
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-yellow-400">
                  <Upload className="w-6 h-6 animate-pulse-slow" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs sm:text-sm font-bold text-white">Drag & Drop M3U File here</p>
                  <p className="text-[10px] text-slate-400 max-w-xs leading-relaxed">
                    পিসির বা মেমোরির যেকোনো ডাউনলোড করা `.m3u` প্লেলিস্ট ফাইলটি এখানে ড্র্যাগ অ্যান্ড ড্রপ করুন অথবা ক্লিক করে ব্রাউজ করুন।
                  </p>
                </div>
                <input
                  type="file"
                  accept=".m3u,.m3u8,.txt"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {errorFile && (
                <div className="text-amber-500 text-[11px] font-bold flex items-center gap-1.5 px-1">
                  <AlertCircle className="w-4 h-4" />
                  <span>{errorFile}</span>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Add Single Channel */}
          {activeTab === 'add_single' && (
            <form onSubmit={handleAddSingleChannel} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider ml-1">Channel Name (নাম)</label>
                  <input
                    type="text"
                    required
                    value={chName}
                    onChange={(e) => setChName(e.target.value)}
                    placeholder="যেমন: Sports HD"
                    className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-hidden focus:ring-2 focus:ring-yellow-500/30 focus:border-yellow-500/50 transition-all font-sans"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider ml-1">Category (ক্যাটাগরি)</label>
                  <select
                    value={chGroup}
                    onChange={(e) => setChGroup(e.target.value)}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-hidden focus:ring-2 focus:ring-yellow-500/30 transition-all"
                  >
                    <option value="Sports">Sports (খেলাধুলা)</option>
                    <option value="News">News (সংবাদ)</option>
                    <option value="Bangla">Bangla (বাংলা)</option>
                    <option value="Hindi">Hindi (হিন্দি)</option>
                    <option value="English">English (ইংরেজি)</option>
                    <option value="Islamic">Islamic (ইসলামিক)</option>
                    <option value="Sonatoni">Sonatoni (সনাতনী)</option>
                    <option value="Kids">Kids (কার্টুন)</option>
                    <option value="Custom">Custom (কাস্টম)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider ml-1">Stream Link/URL (HLS .m3u8 বা অন্যান্য লিঙ্ক)</label>
                <input
                  type="text"
                  required
                  value={chUrl}
                  onChange={(e) => setChUrl(e.target.value)}
                  placeholder="http://.../playlist.m3u8"
                  className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-hidden focus:ring-2 focus:ring-yellow-500/30 focus:border-yellow-500/50 transition-all font-sans"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider ml-1">Logo URL (লোগো লিঙ্ক - অপশনাল)</label>
                <input
                  type="url"
                  value={chLogo}
                  onChange={(e) => setChLogo(e.target.value)}
                  placeholder="https://.../logo.png"
                  className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-hidden focus:ring-2 focus:ring-yellow-500/30 focus:border-yellow-500/50 transition-all font-sans"
                />
              </div>

              {errorSingle && (
                <div className="text-amber-500 text-[11px] font-bold flex items-center gap-1.5 px-1">
                  <AlertCircle className="w-4 h-4" />
                  <span>{errorSingle}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-extrabold py-2.5 rounded-xl text-xs tracking-wider transition-all shadow-md active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>চ্যানেল যোগ করুন (Add Stream)</span>
              </button>
            </form>
          )}

          {/* TAB 4: Saved Playlists */}
          {activeTab === 'saved' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-slate-950/30 px-4 py-3 rounded-2xl border border-white/5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
                    <Tv className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-200">সিস্টেমের ডিফল্ট প্লেলিস্ট</p>
                    <p className="text-[9px] text-slate-500 font-medium">Btv, T Sports এবং অন্যান্য pre-loaded চ্যানেল</p>
                  </div>
                </div>
                {activePlaylistName === 'Default Channels' ? (
                  <span className="flex items-center gap-1 bg-green-500/10 text-green-400 text-[10px] font-bold py-1 px-2.5 rounded-full border border-green-500/20">
                    <Check className="w-3.5 h-3.5" />
                    <span>Active</span>
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      playBeep('select');
                      onSelectDefaultPlaylist();
                      onClose();
                    }}
                    className="text-[10px] font-bold bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl py-1 px-3 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                  >
                    <Play className="w-3 h-3 text-yellow-400" />
                    <span>রিবুট করুন</span>
                  </button>
                )}
              </div>

              {savedPlaylists.length === 0 ? (
                <div className="py-12 border border-dashed border-white/5 rounded-2xl text-center text-slate-500 text-xs">
                  কোনো কাস্টম প্লেলিস্ট বা ম্যানুয়াল চ্যানেল যোগ করা নেই।
                </div>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">কাস্টম প্লেলিস্ট সমূহ</p>
                  {savedPlaylists.map((pl) => {
                    const isActive = activePlaylistName === pl.name;
                    return (
                      <div
                        key={pl.name}
                        onClick={() => {
                          playBeep('select');
                          onPlaylistLoaded(pl.channels, pl.name);
                          onClose();
                        }}
                        className={`group flex justify-between items-center px-4 py-3 rounded-2xl border transition-all cursor-pointer ${
                          isActive 
                            ? 'border-yellow-500/50 bg-yellow-500/5' 
                            : 'border-white/5 bg-slate-950/20 hover:bg-slate-900/30'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                            isActive ? 'bg-yellow-500/10 text-yellow-400' : 'bg-slate-800 text-slate-300'
                          }`}>
                            <FileText className="w-4 h-4" />
                          </div>
                          <div>
                            <p className={`text-xs font-bold ${isActive ? 'text-yellow-400' : 'text-slate-200'}`}>
                              {pl.name}
                            </p>
                            <p className="text-[9px] text-slate-500 font-medium">
                              মোট চ্যানেল: {pl.channelsCount} টি
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {isActive && (
                            <span className="flex items-center gap-1 bg-yellow-500/10 text-yellow-400 text-[10px] font-bold py-1 px-2.5 rounded-full border border-yellow-500/20 mr-1">
                              <Check className="w-3.5 h-3.5" />
                              <span>Active</span>
                            </span>
                          )}
                          <button
                            onClick={(e) => deletePlaylist(pl.name, e)}
                            className="w-7 h-7 rounded-lg bg-white/0 hover:bg-red-500/10 hover:text-red-400 text-slate-400 flex items-center justify-center transition-all cursor-pointer border border-transparent hover:border-red-500/20"
                            title="প্লেলিস্টটি মুছে ফেলুন"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
