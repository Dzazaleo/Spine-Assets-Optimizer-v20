
import React, { useState, useMemo, useEffect } from 'react';
import { X, Plus, Trash2, GripVertical, Search, PlayCircle, FileText, MessageSquare, Layers, Bone, Zap, RotateCcw, AlertTriangle } from 'lucide-react';
import { TrackItem, TrackAnimationConfig, SkinDoc, EventDoc, BoneDoc, ViewerData } from '../types';
import { generateStandaloneHtml } from '../utils/htmlGenerator';
import clsx from 'clsx';

interface TrackConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableAnimations: string[];
  trackList: TrackItem[];
  setTrackList: (list: TrackItem[]) => void;
  
  // New Documentation Props
  skinDocs: SkinDoc[];
  setSkinDocs: (docs: SkinDoc[]) => void;
  eventDocs: EventDoc[];
  setEventDocs: (docs: EventDoc[]) => void;
  boneDocs: BoneDoc[];
  setBoneDocs: (docs: BoneDoc[]) => void;
  generalNotes: string;
  setGeneralNotes: (notes: string) => void;
  
  safetyBuffer: number;
  resizedCount: number;
  optimizationReduction: string;
  projectedAtlasCount: number;
  
  // Metadata
  skeletonName: string;
  totalImages: number;
  totalAnimations: number;
}

type DocSection = 'skins' | 'events' | 'bones' | 'notes';

// Helper for natural sort (e.g., "Item 2" comes before "Item 10")
const naturalSort = (a: { name: string }, b: { name: string }) => {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
};

export const TrackConfigModal: React.FC<TrackConfigModalProps> = ({
  isOpen,
  onClose,
  availableAnimations,
  trackList,
  setTrackList,
  skinDocs,
  setSkinDocs,
  eventDocs,
  setEventDocs,
  boneDocs,
  setBoneDocs,
  generalNotes,
  setGeneralNotes,
  safetyBuffer,
  resizedCount,
  optimizationReduction,
  projectedAtlasCount,
  skeletonName,
  totalImages,
  totalAnimations
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleSections, setVisibleSections] = useState<Set<DocSection>>(new Set());
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Multi-select state for animations sidebar
  const [selectedAnimNames, setSelectedAnimNames] = useState<Set<string>>(new Set());
  const [lastSelectedAnim, setLastSelectedAnim] = useState<string | null>(null);
  
  // Automatically show sections only if they contain actual content (e.g. after loading a config)
  useEffect(() => {
    setVisibleSections(prev => {
      const next = new Set(prev);
      let changed = false;

      // Rule: Show ONLY if at least one item has a non-empty description or general notes is non-empty.
      // This prevents cluttering the UI when names are extracted but descriptions are fresh.
      if (skinDocs.some(d => d.description.trim() !== '') && !next.has('skins')) {
        next.add('skins');
        changed = true;
      }
      if (eventDocs.some(d => d.description.trim() !== '') && !next.has('events')) {
        next.add('events');
        changed = true;
      }
      if (boneDocs.some(d => d.description.trim() !== '') && !next.has('bones')) {
        next.add('bones');
        changed = true;
      }
      if (generalNotes.trim() !== '' && !next.has('notes')) {
        next.add('notes');
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [skinDocs, eventDocs, boneDocs, generalNotes]);

  // Derive used animations set for filtering
  const usedAnimations = useMemo(() => {
    const used = new Set<string>();
    trackList.forEach(track => {
      track.animations.forEach(anim => {
        used.add(anim.name);
      });
    });
    return used;
  }, [trackList]);

  // Track modification state for Conditional Reset Visibility
  const isDocConfigDirty = useMemo(() => {
     const hasTrackChanges = trackList.length !== 5 || trackList.some(t => t.animations.length > 0);
     const hasNoteChanges = generalNotes.trim().length > 0;
     const hasSectionToggles = visibleSections.size > 0;
     
     const hasSkinDesc = skinDocs.some(d => d.description.trim() !== '');
     const hasEventDesc = eventDocs.some(d => d.description.trim() !== '');
     const hasBoneDesc = boneDocs.some(d => d.description.trim() !== '');

     return hasTrackChanges || hasNoteChanges || hasSectionToggles || hasSkinDesc || hasEventDesc || hasBoneDesc;
  }, [trackList, generalNotes, visibleSections, skinDocs, eventDocs, boneDocs]);

  // Filter Logic
  const filteredAnimations = useMemo(() => {
    return availableAnimations
      .filter(anim => {
        // EXPLICIT EXCLUSION: Setup Pose is internal
        if (anim === "Setup Pose (Default)") return false;

        const matchesSearch = anim.toLowerCase().includes(searchTerm.toLowerCase());
        
        if (searchTerm.trim() !== '') {
            return matchesSearch;
        }
        
        return !usedAnimations.has(anim);
      })
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }, [availableAnimations, searchTerm, usedAnimations]);

  if (!isOpen) return null;

  const handleResetDocs = () => {
    // Reset Tracks
    const initialTracks: TrackItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: Math.random().toString(36).substring(2, 9),
      trackIndex: i,
      animations: []
    }));
    setTrackList(initialTracks);

    // Reset Descriptions
    setSkinDocs(skinDocs.map(d => ({ ...d, description: '' })));
    setEventDocs(eventDocs.map(d => ({ ...d, description: '' })));
    setBoneDocs(boneDocs.map(d => ({ ...d, description: '' })));
    
    // Reset Notes
    setGeneralNotes("");
    
    // Reset Toggles
    setVisibleSections(new Set());
    setSelectedAnimNames(new Set());
    setLastSelectedAnim(null);

    setShowResetConfirm(false);
  };

  const toggleSection = (section: DocSection) => {
    const next = new Set(visibleSections);
    if (next.has(section)) {
      next.delete(section);
    } else {
      next.add(section);
    }
    setVisibleSections(next);
  };

  // --- Sidebar Selection Logic ---
  const handleAnimClick = (e: React.MouseEvent, animName: string) => {
    const isShift = e.shiftKey;
    const isCtrl = e.ctrlKey || e.metaKey;

    let nextSelected = new Set(selectedAnimNames);

    if (isShift && lastSelectedAnim) {
      const startIdx = filteredAnimations.indexOf(lastSelectedAnim);
      const endIdx = filteredAnimations.indexOf(animName);
      if (startIdx !== -1 && endIdx !== -1) {
        const [low, high] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
        const range = filteredAnimations.slice(low, high + 1);
        if (!isCtrl) nextSelected.clear();
        range.forEach(name => nextSelected.add(name));
      }
    } else if (isCtrl) {
      if (nextSelected.has(animName)) {
        nextSelected.delete(animName);
      } else {
        nextSelected.add(animName);
      }
      setLastSelectedAnim(animName);
    } else {
      nextSelected = new Set([animName]);
      setLastSelectedAnim(animName);
    }

    setSelectedAnimNames(nextSelected);
  };

  // --- Description Updaters ---

  const updateSkinDesc = (name: string, desc: string) => {
    setSkinDocs(skinDocs.map(doc => doc.name === name ? { ...doc, description: desc } : doc));
  };

  const updateEventDesc = (name: string, desc: string) => {
    setEventDocs(eventDocs.map(doc => doc.name === name ? { ...doc, description: desc } : doc));
  };

  const updateBoneDesc = (name: string, desc: string) => {
    setBoneDocs(boneDocs.map(doc => doc.name === name ? { ...doc, description: desc } : doc));
  };

  // --- Item Removers ---

  const removeSkinDoc = (name: string) => {
    setSkinDocs(skinDocs.filter(doc => doc.name !== name));
  };

  const removeEventDoc = (name: string) => {
    setEventDocs(eventDocs.filter(doc => doc.name !== name));
  };

  const removeBoneDoc = (name: string) => {
    setBoneDocs(boneDocs.filter(doc => doc.name !== name));
  };

  // --- Drag & Drop Handlers ---

  const handleDragStart = (e: React.DragEvent, animName: string) => {
    let namesToDrag: string[] = [];
    
    if (selectedAnimNames.has(animName)) {
      // Drag the whole selected group
      namesToDrag = Array.from(selectedAnimNames);
    } else {
      // User dragged an unselected item, treat it as the only selection
      namesToDrag = [animName];
      setSelectedAnimNames(new Set([animName]));
      setLastSelectedAnim(animName);
    }

    e.dataTransfer.setData('application/spine-anims', JSON.stringify(namesToDrag));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleReorderStart = (e: React.DragEvent, trackIndex: number, animIndex: number) => {
    e.dataTransfer.setData('application/spine-reorder', JSON.stringify({ trackIndex, animIndex }));
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/spine-reorder')) {
        e.dataTransfer.dropEffect = 'move';
    } else {
        e.dataTransfer.dropEffect = 'copy';
    }
  };

  const createAnimConfigs = (names: string[]): TrackAnimationConfig[] => {
    return names.map(name => ({
      id: Math.random().toString(36).substring(2, 9),
      name: name,
      mixDuration: 0.25,
      loop: true,
      notes: ''
    }));
  };

  // Drop onto a specific item (for insertion/reordering)
  const handleItemDrop = (e: React.DragEvent, targetTrackIndex: number, targetAnimIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    // 1. Handle Reorder
    const reorderData = e.dataTransfer.getData('application/spine-reorder');
    if (reorderData) {
      const { trackIndex: srcTrackIdx, animIndex: srcAnimIdx } = JSON.parse(reorderData);
      if (srcTrackIdx === targetTrackIndex && srcAnimIdx === targetAnimIndex) return;

      const newTrackList = trackList.map(t => ({...t, animations: [...t.animations]}));
      const sourceTrack = newTrackList[srcTrackIdx];
      const targetTrack = newTrackList[targetTrackIndex];
      const [movedItem] = sourceTrack.animations.splice(srcAnimIdx, 1);
      
      let insertIndex = targetAnimIndex;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mid = rect.top + (rect.height / 2);
      const isBottom = e.clientY > mid;
      if (isBottom) insertIndex++;
      if (srcTrackIdx === targetTrackIndex && srcAnimIdx < insertIndex) insertIndex--;

      targetTrack.animations.splice(insertIndex, 0, movedItem);
      setTrackList(newTrackList);
      return;
    }

    // 2. Handle New Animations (Sidebar Drop)
    const animsData = e.dataTransfer.getData('application/spine-anims');
    if (animsData) {
      const names = JSON.parse(animsData) as string[];
      const newConfigs = createAnimConfigs(names);
      const newTrackList = trackList.map(t => ({...t, animations: [...t.animations]}));
      const targetTrack = newTrackList[targetTrackIndex];
      
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mid = rect.top + (rect.height / 2);
      const isBottom = e.clientY > mid;
      const insertIndex = isBottom ? targetAnimIndex + 1 : targetAnimIndex;
      
      targetTrack.animations.splice(insertIndex, 0, ...newConfigs);
      setTrackList(newTrackList);
      setSelectedAnimNames(new Set()); // Clear selection after drop
    }
  };

  // Drop onto the track container (Append)
  const handleContainerDrop = (e: React.DragEvent, trackIndex: number) => {
    e.preventDefault();
    
    // 1. Handle Reorder (Append to end)
    const reorderData = e.dataTransfer.getData('application/spine-reorder');
    if (reorderData) {
       const { trackIndex: srcTrackIdx, animIndex: srcAnimIdx } = JSON.parse(reorderData);
       const newTrackList = trackList.map(t => ({...t, animations: [...t.animations]}));
       const [item] = newTrackList[srcTrackIdx].animations.splice(srcAnimIdx, 1);
       newTrackList[trackIndex].animations.push(item);
       setTrackList(newTrackList);
       return;
    }

    // 2. Handle New Animations (Append to end)
    const animsData = e.dataTransfer.getData('application/spine-anims');
    if (animsData) {
      const names = JSON.parse(animsData) as string[];
      const newConfigs = createAnimConfigs(names);
      const newList = [...trackList];
      newList[trackIndex] = {
        ...newList[trackIndex],
        animations: [...newList[trackIndex].animations, ...newConfigs]
      };
      setTrackList(newList);
      setSelectedAnimNames(new Set()); // Clear selection after drop
    }
  };

  // --- Track Manipulation ---

  const updateAnimation = (trackIndex: number, animId: string, updates: Partial<TrackAnimationConfig>) => {
    const newList = [...trackList];
    const track = newList[trackIndex];
    
    const animIndex = track.animations.findIndex(a => a.id === animId);
    if (animIndex === -1) return;

    const newAnimations = [...track.animations];
    newAnimations[animIndex] = { ...newAnimations[animIndex], ...updates };
    
    newList[trackIndex] = { ...track, animations: newAnimations };
    setTrackList(newList);
  };

  const removeAnimation = (trackIndex: number, animId: string) => {
    const newList = [...trackList];
    const track = newList[trackIndex];
    const newAnimations = track.animations.filter(a => a.id !== animId);
    newList[trackIndex] = { ...track, animations: newAnimations };
    setTrackList(newList);
  };

  const removeTrack = (index: number) => {
    const newList = [...trackList];
    newList.splice(index, 1);
    const reindexed = newList.map((t, i) => ({ ...t, trackIndex: i }));
    setTrackList(reindexed);
  };

  const addTrack = () => {
    const newIndex = trackList.length;
    setTrackList([
      ...trackList,
      {
        id: Math.random().toString(36).substring(2, 9),
        trackIndex: newIndex,
        animations: []
      }
    ]);
  };

  const handleExportHtml = () => {
    // Filter documentation data based on enabled sections (visible in UI)
    const exportSkinDocs = visibleSections.has('skins') ? skinDocs : [];
    const exportEventDocs = visibleSections.has('events') ? eventDocs : [];
    const exportBoneDocs = visibleSections.has('bones') ? boneDocs : [];
    const exportGeneralNotes = visibleSections.has('notes') ? generalNotes : "";

    const data: ViewerData = {
        trackList,
        skinDocs: exportSkinDocs,
        eventDocs: exportEventDocs,
        boneDocs: exportBoneDocs,
        generalNotes: exportGeneralNotes,
        safetyBuffer,
        timestamp: new Date().toISOString(),
        skeletonName,
        totalImages,
        totalAnimations,
        resizedCount,
        optimizationReduction,
        projectedAtlasCount
    };

    const content = generateStandaloneHtml(data);
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spine-documentation-${skeletonName.replace(/\.[^/.]+$/, "")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden border border-gray-700 rounded-xl bg-spine-dark shadow-2xl relative">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800/50">
          <div>
            <h3 className="text-xl font-semibold text-white">Spine Documentation Builder</h3>
            <p className="text-xs text-gray-400">Configure tracks and document events, bones, and skins for <span className="text-spine-accent">{skeletonName}</span>.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* Left Panel: Source Animations */}
          <div className="w-1/3 min-w-[300px] border-r border-gray-700 bg-gray-900/30 flex flex-col">
            <div className="p-4 border-b border-gray-700 bg-gray-900/50">
               <div className="relative">
                  <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
                  <input 
                    type="text" 
                    placeholder="Search animations..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                  />
               </div>
               {selectedAnimNames.size > 0 && (
                  <div className="mt-2 flex items-center justify-between">
                     <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-tight">{selectedAnimNames.size} selected</span>
                     <button onClick={() => setSelectedAnimNames(new Set())} className="text-[10px] text-gray-500 hover:text-gray-300">Clear</button>
                  </div>
               )}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 select-none">
              {filteredAnimations.length === 0 ? (
                <div className="p-8 text-center text-gray-500 italic text-sm">
                  {availableAnimations.length === 0 
                     ? "No animations found in loaded JSON." 
                     : searchTerm 
                       ? "No matching animations." 
                       : "All animations placed."
                  }
                </div>
              ) : (
                filteredAnimations.map(anim => (
                  <div 
                    key={anim}
                    draggable
                    onDragStart={(e) => handleDragStart(e, anim)}
                    onClick={(e) => handleAnimClick(e, anim)}
                    className={clsx(
                      "p-3 rounded cursor-grab active:cursor-grabbing group flex items-center gap-3 transition-all border",
                      selectedAnimNames.has(anim) 
                        ? "bg-spine-accent/20 border-spine-accent/50 shadow-sm" 
                        : "bg-gray-800/50 hover:bg-gray-700 border-gray-700 hover:border-emerald-500/50"
                    )}
                  >
                    <GripVertical className={clsx("shrink-0", selectedAnimNames.has(anim) ? "text-spine-accent" : "text-gray-600 group-hover:text-gray-400")} size={16} />
                    <span className={clsx("text-sm font-medium truncate", selectedAnimNames.has(anim) ? "text-white" : "text-gray-200")}>{anim}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Panel: Configuration */}
          <div className="flex-1 flex flex-col bg-black/20">
             <div className="flex-1 overflow-y-auto p-4 space-y-8">
                
                {/* 1. Track List Section */}
                <div className="space-y-4">
                    {trackList.map((track, idx) => (
                      <div 
                        key={track.id}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleContainerDrop(e, idx)}
                        className="rounded-xl border border-gray-700 bg-gray-800/20 overflow-hidden"
                      >
                        <div className="flex items-center justify-between px-4 py-3 bg-gray-800/80 border-b border-gray-700">
                           <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Track</span>
                              <span className="text-xl font-mono text-white font-bold">{track.trackIndex}</span>
                           </div>
                           <button 
                             onClick={() => removeTrack(idx)}
                             className="p-1.5 text-gray-500 hover:text-red-400 transition-colors rounded hover:bg-red-900/20"
                           >
                              <Trash2 size={16} />
                           </button>
                        </div>

                        <div className="p-2 space-y-2 min-h-[80px]">
                           {track.animations.length === 0 ? (
                              <div className="flex flex-col items-center justify-center py-6 text-gray-600 border-2 border-dashed border-gray-700/50 rounded-lg">
                                 <span className="text-sm italic">Drop animations here</span>
                              </div>
                           ) : (
                              track.animations.map((anim, animIndex) => (
                                 <div 
                                    key={anim.id} 
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleItemDrop(e, idx, animIndex)}
                                    className="flex items-center gap-3 p-3 bg-gray-900/60 border border-gray-700 rounded-lg group hover:border-gray-600 transition-colors"
                                 >
                                    <div 
                                        className="text-gray-600 cursor-grab active:cursor-grabbing hover:text-gray-400 p-1 rounded hover:bg-white/5"
                                        draggable
                                        onDragStart={(e) => handleReorderStart(e, idx, animIndex)}
                                    >
                                       <GripVertical size={16} />
                                    </div>
                                    <div className="w-1/4 min-w-[150px]">
                                       <label className="text-[10px] font-bold text-gray-500 uppercase block mb-0.5">Animation</label>
                                       <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm truncate" title={anim.name}>
                                          <PlayCircle size={14} className="shrink-0" />
                                          <span className="truncate">{anim.name}</span>
                                       </div>
                                    </div>
                                    <div className="flex-1 grid grid-cols-12 gap-3 items-center">
                                       <div className="col-span-2">
                                          <label className="text-[10px] font-bold text-gray-500 uppercase block mb-0.5">Mix (s)</label>
                                          <input 
                                            type="number" 
                                            step="0.05"
                                            min="0"
                                            value={anim.mixDuration}
                                            onChange={(e) => updateAnimation(idx, anim.id, { mixDuration: parseFloat(e.target.value) || 0 })}
                                            className="w-full p-1.5 bg-gray-800 border border-gray-600 rounded text-xs text-white focus:border-emerald-500 focus:outline-none"
                                          />
                                       </div>
                                       <div className="col-span-1 flex flex-col items-center">
                                          <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Loop</label>
                                          <input 
                                            type="checkbox"
                                            checked={anim.loop}
                                            onChange={(e) => updateAnimation(idx, anim.id, { loop: e.target.checked })}
                                            className="w-4 h-4 rounded cursor-pointer accent-emerald-500 bg-gray-800 border-gray-600"
                                          />
                                       </div>
                                       <div className="col-span-9">
                                          <label className="text-[10px] font-bold text-gray-500 uppercase block mb-0.5">Notes</label>
                                          <input 
                                            type="text" 
                                            placeholder="Add note..."
                                            value={anim.notes}
                                            onChange={(e) => updateAnimation(idx, anim.id, { notes: e.target.value })}
                                            className="w-full p-1.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 focus:border-emerald-500 focus:outline-none placeholder:text-gray-600"
                                          />
                                       </div>
                                    </div>
                                    <button 
                                       onClick={() => removeAnimation(idx, anim.id)}
                                       className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors self-end mb-0.5"
                                    >
                                       <X size={16} />
                                    </button>
                                 </div>
                              ))
                           )}
                           {track.animations.length > 0 && (
                              <div className="h-2 w-full rounded-full bg-gray-800/30"></div>
                           )}
                        </div>
                      </div>
                    ))}
                    <button 
                      onClick={addTrack}
                      className="w-full py-4 flex items-center justify-center gap-2 border-2 border-dashed border-gray-700 rounded-xl text-gray-500 hover:text-gray-300 hover:border-gray-500 hover:bg-gray-800/30 transition-all"
                    >
                       <Plus size={20} />
                       <span>Add New Track Container</span>
                    </button>
                </div>

                {/* 2. Optional Sections Toolbar */}
                <div className="pt-2">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Documentation Sections</h4>
                    <div className="flex flex-wrap gap-3">
                        {!visibleSections.has('events') && (
                            <button 
                                onClick={() => toggleSection('events')}
                                className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                            >
                                <Zap size={14} className="text-yellow-400" />
                                Add Events ({eventDocs.length})
                            </button>
                        )}
                        {!visibleSections.has('skins') && (
                            <button 
                                onClick={() => toggleSection('skins')}
                                className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                            >
                                <Layers size={14} className="text-blue-400" />
                                Add Skins ({skinDocs.length})
                            </button>
                        )}
                        {!visibleSections.has('bones') && (
                            <button 
                                onClick={() => toggleSection('bones')}
                                className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                            >
                                <Bone size={14} className="text-gray-400" />
                                Add Control Bones ({boneDocs.length})
                            </button>
                        )}
                        {!visibleSections.has('notes') && (
                            <button 
                                onClick={() => toggleSection('notes')}
                                className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                            >
                                <MessageSquare size={14} className="text-emerald-400" />
                                Add General Notes
                            </button>
                        )}
                    </div>
                </div>

                {/* 3. Render Active Sections */}
                
                {visibleSections.has('events') && (
                    <div className="bg-gray-800/40 rounded-xl border border-gray-700 overflow-hidden">
                        <div className="px-4 py-3 bg-gray-800/80 border-b border-gray-700 flex justify-between items-center">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Zap size={16} className="text-yellow-400" /> Events
                            </h3>
                            <button onClick={() => toggleSection('events')} className="text-gray-500 hover:text-red-400"><X size={16} /></button>
                        </div>
                        <div className="p-4 space-y-4">
                            {eventDocs.length === 0 ? <p className="text-sm text-gray-500 italic">No events found in JSON.</p> : 
                             [...eventDocs].sort(naturalSort).map((doc) => (
                                <div key={doc.name} className="flex flex-col gap-1 group">
                                    <div className="flex justify-between items-center">
                                       <label className="text-xs font-mono text-yellow-500/80 select-all">{doc.name}</label>
                                       <button 
                                          onClick={() => removeEventDoc(doc.name)}
                                          className="text-gray-600 hover:text-red-400 p-1 transition-colors"
                                          title="Remove event"
                                       >
                                          <X size={14} />
                                       </button>
                                    </div>
                                    <textarea 
                                        placeholder="Description (e.g., Trigger particle effect)"
                                        value={doc.description}
                                        onChange={(e) => updateEventDesc(doc.name, e.target.value)}
                                        className="w-full p-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200 focus:border-emerald-500 focus:outline-none min-h-[50px] resize-y"
                                        rows={2}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {visibleSections.has('skins') && (
                    <div className="bg-gray-800/40 rounded-xl border border-gray-700 overflow-hidden">
                        <div className="px-4 py-3 bg-gray-800/80 border-b border-gray-700 flex justify-between items-center">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Layers size={16} className="text-blue-400" /> Skins
                            </h3>
                            <button onClick={() => toggleSection('skins')} className="text-gray-500 hover:text-red-400"><X size={16} /></button>
                        </div>
                        <div className="p-4 space-y-4">
                            {skinDocs.length === 0 ? <p className="text-sm text-gray-500 italic">No skins found in JSON.</p> : 
                             [...skinDocs].sort(naturalSort).map((doc) => (
                                <div key={doc.name} className="flex flex-col gap-1 group">
                                    <div className="flex justify-between items-center">
                                       <label className="text-xs font-mono text-blue-400/80 select-all">{doc.name}</label>
                                       <button 
                                          onClick={() => removeSkinDoc(doc.name)}
                                          className="text-gray-600 hover:text-red-400 p-1 transition-colors"
                                          title="Remove skin"
                                       >
                                          <X size={14} />
                                       </button>
                                    </div>
                                    <textarea 
                                        placeholder="Description (e.g., Use for level 1)"
                                        value={doc.description}
                                        onChange={(e) => updateSkinDesc(doc.name, e.target.value)}
                                        className="w-full p-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200 focus:border-emerald-500 focus:outline-none min-h-[50px] resize-y"
                                        rows={2}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {visibleSections.has('bones') && (
                    <div className="bg-gray-800/40 rounded-xl border border-gray-700 overflow-hidden">
                        <div className="px-4 py-3 bg-gray-800/80 border-b border-gray-700 flex justify-between items-center">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Bone size={16} className="text-gray-400" /> Control Bones (CTRL_)
                            </h3>
                            <button onClick={() => toggleSection('bones')} className="text-gray-500 hover:text-red-400"><X size={16} /></button>
                        </div>
                        <div className="p-4 space-y-4">
                            {boneDocs.length === 0 ? <p className="text-sm text-gray-500 italic">No control bones found in JSON.</p> : 
                             [...boneDocs].sort(naturalSort).map((doc) => (
                                <div key={doc.name} className="flex flex-col gap-1 group">
                                    <div className="flex justify-between items-center">
                                       <label className="text-xs font-mono text-gray-400 select-all">{doc.name}</label>
                                       <button 
                                          onClick={() => removeBoneDoc(doc.name)}
                                          className="text-gray-600 hover:text-red-400 p-1 transition-colors"
                                          title="Remove control bone"
                                       >
                                          <X size={14} />
                                       </button>
                                    </div>
                                    <textarea 
                                        placeholder="Description (e.g., Controls aim direction)"
                                        value={doc.description}
                                        onChange={(e) => updateBoneDesc(doc.name, e.target.value)}
                                        className="w-full p-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200 focus:border-emerald-500 focus:outline-none min-h-[50px] resize-y"
                                        rows={2}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {visibleSections.has('notes') && (
                    <div className="bg-gray-800/40 rounded-xl border border-gray-700 overflow-hidden">
                        <div className="px-4 py-3 bg-gray-800/80 border-b border-gray-700 flex justify-between items-center">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <MessageSquare size={16} className="text-emerald-400" /> General Notes
                            </h3>
                            <button onClick={() => toggleSection('notes')} className="text-gray-500 hover:text-red-400"><X size={16} /></button>
                        </div>
                        <div className="p-4">
                            <textarea 
                                placeholder="Enter general notes, implementation details, or warnings..."
                                value={generalNotes}
                                onChange={(e) => setGeneralNotes(e.target.value)}
                                className="w-full h-32 p-3 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200 focus:border-emerald-500 focus:outline-none resize-y"
                            />
                        </div>
                    </div>
                )}

             </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 bg-gray-800/50 flex justify-between items-center">
           <span className="text-xs text-gray-500 hidden md:inline">
             Drag animations to tracks. Multi-select with Ctrl/Shift. Reorder items with the grip handle.
           </span>
           
           <div className="flex items-center gap-3 ml-auto">
             {isDocConfigDirty && (
                <button
                   onClick={() => setShowResetConfirm(true)}
                   className="h-10 flex items-center gap-2 px-3 py-2 text-sm font-bold text-red-400 hover:text-red-300 border border-transparent hover:border-red-900/50 hover:bg-red-900/20 rounded transition-all mr-2"
                   title="Reset all tracks and documentation"
                >
                   <RotateCcw size={16} />
                   <span className="hidden sm:inline">Reset All</span>
                </button>
             )}

             <button
                onClick={handleExportHtml}
                className="h-10 flex items-center gap-2 px-4 py-2 text-sm font-bold text-blue-200 bg-blue-900/30 border border-blue-800/50 rounded hover:bg-blue-800 hover:text-white transition-all"
             >
                <FileText size={16} />
                Export HTML Docs
             </button>

             <button 
               onClick={onClose}
               className="h-10 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded shadow-lg transition-colors"
             >
               Done
             </button>
           </div>
        </div>

        {/* Confirmation Modal */}
        {showResetConfirm && (
            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                <div className="bg-gray-800 border border-gray-600 p-6 rounded-xl shadow-2xl max-w-md w-full animate-in fade-in zoom-in duration-200">
                    <div className="flex items-center gap-3 mb-4 text-red-400">
                        <AlertTriangle size={24} />
                        <h3 className="text-lg font-bold text-white">Reset Documentation?</h3>
                    </div>
                    <p className="text-sm text-gray-300 mb-6 leading-relaxed">
                        Are you sure you want to reset all documentation data? <br/>
                        <span className="text-red-300 font-semibold">This will clear all tracks, notes, and descriptions.</span>
                    </p>
                    <div className="flex justify-end gap-3">
                        <button 
                            onClick={() => setShowResetConfirm(false)}
                            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleResetDocs}
                            className="px-4 py-2 text-sm font-bold bg-red-600 hover:bg-red-500 text-white rounded shadow-lg shadow-red-900/20 transition-colors"
                        >
                            Yes, Reset Everything
                        </button>
                    </div>
                </div>
            </div>
        )}

      </div>
    </div>
  );
};
