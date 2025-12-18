import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DropZone } from './components/DropZone';
import { AnimationCard } from './components/AnimationCard';
import { SkeletonGroup } from './components/SkeletonGroup';
import { OptimizationModal } from './components/OptimizationModal';
import { PercentageOverrideModal } from './components/PercentageOverrideModal';
import { GlobalStatsSummary } from './components/GlobalStatsSummary';
import { UnusedAssetsCard } from './components/UnusedAssetsCard';
import { MissingAssetsCard } from './components/MissingAssetsCard';
import { AtlasPreviewModal } from './components/AtlasPreviewModal';
import { AnalysisProgressModal } from './components/AnalysisProgressModal';
import { TrackConfigModal } from './components/TrackConfigModal';
import { ScrollToTop } from './components/ScrollToTop';
import { AnalysisReport, FileAsset, OptimizationTask, OptimizerConfig, TrackItem, SkinDoc, EventDoc, BoneDoc, SpineProject, AnalysisResult, LoadedImageAsset } from './types';
import { analyzeSpineData, extractCanonicalDimensions, mergeAnalysisReports, getImplicitlyUsedAtlasPages } from './utils/spineParser';
import { calculateOptimizationTargets, generateOptimizedZip } from './utils/optimizer';
import { packAtlases } from './utils/atlasPacker';
import { unpackAtlas } from './utils/atlasUnpacker';
import { parseAtlas } from './utils/atlasParser';
import { Activity, Layers, Search, X, Zap, CheckSquare, RotateCcw, Download, Upload, Film, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react';

type SortKey = 'path' | 'originalSize' | 'maxRenderSize' | 'sourceAnimation' | 'sourceSkeleton';

interface SearchMatch {
  type: 'global' | 'anim';
  key: string;
  animName?: string;
  skeletonName?: string;
}

export default function App() {
  // Spine Skeleton State (Multi-Project)
  const [loadedSkeletons, setLoadedSkeletons] = useState<Map<string, SpineProject>>(new Map());
  
  // inMemoryImages: Map of path -> Loaded Image Asset
  const [inMemoryImages, setInMemoryImages] = useState<Map<string, LoadedImageAsset>>(new Map());
  
  // Atlas tracking
  const [atlasCount, setAtlasCount] = useState(0);

  // Atlas page names that are implicitly used
  const [atlasPageNames, setAtlasPageNames] = useState<Set<string>>(new Set());

  // Asset Resolution Overrides (Path -> Percentage)
  const [assetOverrides, setAssetOverrides] = useState<Map<string, number>>(new Map());

  // Local Scale Overrides for missing keyframes (AnimationName|LookupKey -> boolean)
  const [localScaleOverrides, setLocalScaleOverrides] = useState<Set<string>>(new Set());

  // Multi-Select State
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);

  // Analysis Report (Merged)
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  
  // Global Collapse/Expand State
  const [allExpanded, setAllExpanded] = useState(false);

  // Sorting State for Global Stats
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ 
    key: 'path', 
    direction: 'asc' 
  });

  // Deep Link State
  const [expandTrigger, setExpandTrigger] = useState<{name: string, skeletonName?: string, assetKey?: string, ts: number} | null>(null);
  const animationRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Search Navigation State
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [focusedGlobalKey, setFocusedGlobalKey] = useState<string | null>(null);

  // Optimization Modal State
  const [isOptModalOpen, setIsOptModalOpen] = useState(false);
  const [optTasks, setOptTasks] = useState<OptimizationTask[]>([]);
  const [optimizationBuffer, setOptimizationBuffer] = useState(1);
  const [isProcessingOpt, setIsProcessingOpt] = useState(false);
  const [optProgress, setOptProgress] = useState({ current: 0, total: 100 });

  // Override Modal State
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [selectedAssetForOverride, setSelectedAssetForOverride] = useState<{lookupKey: string, path: string, overridePercentage?: number} | null>(null);

  // Atlas Preview State
  const [isAtlasModalOpen, setIsAtlasModalOpen] = useState(false);
  const [atlasTasks, setAtlasTasks] = useState<OptimizationTask[]>([]);

  // Documentation / Track Builder State
  const [isTrackModalOpen, setIsTrackModalOpen] = useState(false);
  const [trackList, setTrackList] = useState<TrackItem[]>(() => 
    Array.from({ length: 5 }, (_, i) => ({
      id: Math.random().toString(36).substring(2, 9),
      trackIndex: i,
      animations: []
    }))
  );
  
  // New Documentation State
  const [skinDocs, setSkinDocs] = useState<SkinDoc[]>([]);
  const [eventDocs, setEventDocs] = useState<EventDoc[]>([]);
  const [boneDocs, setBoneDocs] = useState<BoneDoc[]>([]);
  const [generalNotes, setGeneralNotes] = useState("");

  // Initial Analysis Loading State
  const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 100 });
  const [analysisStatus, setAnalysisStatus] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce Search Term
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setCurrentMatchIndex(-1);
      setFocusedGlobalKey(null);
    }, 200);

    return () => {
      clearTimeout(handler);
    };
  }, [searchTerm]);

  const handleFilesLoaded = async (assets: FileAsset[]) => {
    setIsAnalysisLoading(true);
    setAnalysisStatus("Initializing...");
    setAnalysisProgress({ current: 0, total: 100 });

    try {
      const newJsonAssets = assets.filter(a => a.file.name.toLowerCase().endsWith('.json'));
      const newAtlasAssets = assets.filter(a => a.file.name.toLowerCase().endsWith('.atlas'));
      const newImageAssets = assets.filter(a => a.file.type.startsWith('image/'));

      let currentSkeletons = new Map<string, SpineProject>(loadedSkeletons);
      let currentAtlasPageNames = new Set<string>(atlasPageNames);
      
      let currentInMemoryImages = newImageAssets.length > 0
          ? new Map<string, LoadedImageAsset>()
          : new Map<string, LoadedImageAsset>(inMemoryImages);
      
      if (newJsonAssets.length > 0) {
         for (const asset of newJsonAssets) {
             const text = await asset.file.text();
             try {
                const data = JSON.parse(text);
                const id = asset.file.name.replace(/\.json$/i, '');
                currentSkeletons.set(id, {
                    id,
                    data,
                    file: asset.file
                });
             } catch (e) {
                console.error("JSON Parse Error", e);
                alert(`Failed to parse JSON: ${asset.file.name}`);
             }
         }
         if (newJsonAssets.length > 0 && loadedSkeletons.size === 0) {
            setAssetOverrides(new Map());
            setLocalScaleOverrides(new Set());
            setSelectedKeys(new Set());
         }
      }

      setAnalysisStatus("Stage 2: Processing Images & Atlases...");
      setAnalysisProgress({ current: 20, total: 100 });
      
      if (newAtlasAssets.length > 0) {
        setAtlasCount(prev => prev + newAtlasAssets.length);
        const pageCandidates = new Map<string, Blob>();
        newImageAssets.forEach(a => pageCandidates.set(a.file.name, a.file));
        
        if (newImageAssets.length === 0) {
             currentInMemoryImages.forEach(a => {
                 if (a.blob instanceof File || a.blob instanceof Blob) {
                     pageCandidates.set(a.name.split('/').pop() || a.name, a.blob);
                 }
             });
        }

        for (const atlasAsset of newAtlasAssets) {
            setAnalysisStatus(`Unpacking Atlas: ${atlasAsset.file.name}...`);
            const atlasText = await atlasAsset.file.text();
            
            const atlasMetadata = parseAtlas(atlasText);
            const implicitPages = getImplicitlyUsedAtlasPages(atlasMetadata);
            implicitPages.forEach(p => currentAtlasPageNames.add(p));

            const unpackedAssets = await unpackAtlas(atlasText, pageCandidates);
            
            unpackedAssets.forEach(ua => {
                const normalizedPath = ua.path.replace(/\\/g, '/');
                currentInMemoryImages.set(normalizedPath, {
                    name: normalizedPath,
                    blob: ua.file,
                    width: ua.width || 0,
                    height: ua.height || 0,
                    sourceWidth: ua.width,
                    sourceHeight: ua.height,
                    url: URL.createObjectURL(ua.file)
                });
            });
        }
      }

      const unifiedCanonicalDims = new Map<string, { width: number, height: number }>();
      currentSkeletons.forEach(proj => {
          const dims = extractCanonicalDimensions(proj.data);
          dims.forEach((v, k) => unifiedCanonicalDims.set(k, v));
      });

      if (newImageAssets.length > 0) {
          for (const asset of newImageAssets) {
             if (currentAtlasPageNames.has(asset.file.name)) continue;

             const normalizedPath = asset.path.replace(/\\/g, '/');
             const lookupKey = normalizedPath.toLowerCase();
             
             let noExt = lookupKey;
             const lastDotIndex = lookupKey.lastIndexOf('.');
             if (lastDotIndex !== -1) {
                 noExt = lookupKey.substring(0, lastDotIndex);
             }

             let canonical = unifiedCanonicalDims.get(noExt);
             if (!canonical && noExt.startsWith('images/')) {
                 canonical = unifiedCanonicalDims.get(noExt.substring(7)); 
             }
             if (!canonical) {
                 const firstSlash = noExt.indexOf('/');
                 if (firstSlash !== -1) {
                     const strippedPrefix = noExt.substring(firstSlash + 1);
                     canonical = unifiedCanonicalDims.get(strippedPrefix);
                 }
             }
             
             const physicalW = asset.width || 0;
             const physicalH = asset.height || 0;
             
             let finalW = physicalW;
             let finalH = physicalH;
             
             if (canonical) {
                 finalW = canonical.width;
                 finalH = canonical.height;
             }

             if (!currentInMemoryImages.has(normalizedPath)) {
                 currentInMemoryImages.set(normalizedPath, {
                     name: normalizedPath,
                     blob: asset.file,
                     width: finalW,   
                     height: finalH, 
                     sourceWidth: physicalW,   
                     sourceHeight: physicalH, 
                     url: URL.createObjectURL(asset.file)
                 });
             }
          }
      }

      setAnalysisStatus("Stage 3: Analyzing Skeletons...");
      setAnalysisProgress({ current: 85, total: 100 });

      const processedMap = new Map<string, { width: number, height: number, sourceWidth?: number, sourceHeight?: number, file: File, originalPath: string }>();
      currentInMemoryImages.forEach((asset: LoadedImageAsset) => {
          const file = new File([asset.blob], asset.name, { type: asset.blob.type || 'image/png' });
          const normalizedKey = asset.name.replace(/\\/g, '/').toLowerCase();
          processedMap.set(normalizedKey, {
              width: asset.width,
              height: asset.height,
              sourceWidth: asset.sourceWidth,
              sourceHeight: asset.sourceHeight,
              file: file,
              originalPath: asset.name
          });
      });

      let mergedReport: AnalysisReport | null = report;

      if (currentSkeletons.size > 0) {
         const individualReports: AnalysisReport[] = [];
         
         currentSkeletons.forEach((project) => {
             const r = analyzeSpineData(project.data, processedMap, assetOverrides, localScaleOverrides, project.id);
             individualReports.push(r);
         });

         mergedReport = mergeAnalysisReports(individualReports, processedMap, currentAtlasPageNames);

         if (newJsonAssets.length > 0) {
             setSkinDocs(prev => {
                const existing = new Set(prev.map(d => d.name));
                const newItems = mergedReport!.skins.filter(n => !existing.has(n)).map(name => ({ name, description: '' }));
                return [...prev, ...newItems];
             });
             setEventDocs(prev => {
                const existing = new Set(prev.map(d => d.name));
                const newItems = mergedReport!.events.filter(n => !existing.has(n)).map(name => ({ name, description: '' }));
                return [...prev, ...newItems];
             });
             setBoneDocs(prev => {
                const existing = new Set(prev.map(d => d.name));
                const newItems = mergedReport!.controlBones.filter(n => !existing.has(n)).map(name => ({ name, description: '' }));
                return [...prev, ...newItems];
             });
         }
      }

      setAnalysisStatus("Stage 4: Finalizing Report...");
      setAnalysisProgress({ current: 95, total: 100 });
      await new Promise(resolve => setTimeout(resolve, 600));

      setLoadedSkeletons(currentSkeletons);
      setInMemoryImages(currentInMemoryImages);
      setAtlasPageNames(currentAtlasPageNames);
      setReport(mergedReport);
      
      setAnalysisProgress({ current: 100, total: 100 });
      
    } catch (error) {
       console.error("Processing failed", error);
       alert("An error occurred during file processing.");
    } finally {
       setIsAnalysisLoading(false);
    }
  };

  const handleClearAssets = () => {
    setLoadedSkeletons(new Map());
    setInMemoryImages(new Map());
    setAtlasPageNames(new Set());
    setAtlasCount(0);
    
    setAssetOverrides(new Map());
    setLocalScaleOverrides(new Set());
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
    
    setReport(null);
    setSearchTerm("");
    setDebouncedSearchTerm("");
    
    setTrackList(Array.from({ length: 5 }, (_, i) => ({
      id: Math.random().toString(36).substring(2, 9),
      trackIndex: i,
      animations: []
    })));
    setSkinDocs([]);
    setEventDocs([]);
    setBoneDocs([]);
    setGeneralNotes("");

    setOptimizationBuffer(1);
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const processedAssets = useMemo(() => {
    const map = new Map<string, { width: number, height: number, sourceWidth?: number, sourceHeight?: number, file: File, originalPath: string }>();
    inMemoryImages.forEach((asset: LoadedImageAsset) => {
        const file = new File([asset.blob], asset.name, { type: asset.blob.type || 'image/png' });
        const normalizedKey = asset.name.replace(/\\/g, '/').toLowerCase();
        map.set(normalizedKey, {
            width: asset.width,
            height: asset.height,
            sourceWidth: asset.sourceWidth,
            sourceHeight: asset.sourceHeight,
            file: file,
            originalPath: asset.name
        });
    });
    return map;
  }, [inMemoryImages]);

  useEffect(() => {
    if (!isAnalysisLoading && loadedSkeletons.size > 0) {
      const individualReports: AnalysisReport[] = [];
      loadedSkeletons.forEach((project) => {
          const r = analyzeSpineData(project.data, processedAssets, assetOverrides, localScaleOverrides, project.id);
          individualReports.push(r);
      });
      const merged = mergeAnalysisReports(individualReports, processedAssets, atlasPageNames);
      setReport(merged);
    }
  }, [loadedSkeletons, processedAssets, assetOverrides, localScaleOverrides, isAnalysisLoading, atlasPageNames]);

  const optimizationStats = useMemo(() => {
    if (!report) return { resizedCount: 0, reduction: "0.0", atlasCount: 0 };
    
    const tasks = calculateOptimizationTargets(report.globalStats, processedAssets, optimizationBuffer);
    
    let resizedCount = 0;
    let totalOriginalPixels = 0;
    let totalTargetPixels = 0;
    
    tasks.forEach(t => {
      if (t.isResize) resizedCount++;
      totalOriginalPixels += t.originalWidth * t.originalHeight;
      totalTargetPixels += t.targetWidth * t.targetHeight;
    });
    
    const reduction = totalOriginalPixels > 0 
      ? ((totalOriginalPixels - totalTargetPixels) / totalOriginalPixels * 100).toFixed(1)
      : "0.0";
      
    const atlasPages = packAtlases(tasks, 2048, 2);
      
    return { resizedCount, reduction, atlasCount: atlasPages.length };
  }, [report, processedAssets, optimizationBuffer]);

  const handleOpenOptimization = () => {
    if (!report) return;
    const tasks = calculateOptimizationTargets(report.globalStats, processedAssets, optimizationBuffer);
    setOptTasks(tasks);
    setIsOptModalOpen(true);
  };

  const handleAtlasPreviewFromModal = () => {
    setAtlasTasks(optTasks);
    setIsAtlasModalOpen(true);
  };

  const handleBufferChange = (newBuffer: number) => {
    if (!report) return;
    setOptimizationBuffer(newBuffer);
    const tasks = calculateOptimizationTargets(report.globalStats, processedAssets, newBuffer);
    setOptTasks(tasks);
  };

  const handleRunOptimization = async () => {
    setIsProcessingOpt(true);
    setOptProgress({ current: 0, total: optTasks.length });
    try {
      const blob = await generateOptimizedZip(optTasks, (current, total) => {
        setOptProgress({ current, total });
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "images_resized.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setTimeout(() => {
        setIsProcessingOpt(false);
        setIsOptModalOpen(false);
      }, 1000);
    } catch (error) {
      console.error("Optimization failed", error);
      alert("Failed to generate optimized images.");
      setIsProcessingOpt(false);
    }
  };

  const handleSelectionAction = (key: string, visibleKeys: string[], modifiers: { shiftKey: boolean, ctrlKey: boolean, metaKey: boolean }) => {
    const newSelected = new Set(selectedKeys);
    
    if (modifiers.shiftKey && lastSelectedKey) {
        const startIdx = visibleKeys.indexOf(lastSelectedKey);
        const endIdx = visibleKeys.indexOf(key);
        
        if (startIdx !== -1 && endIdx !== -1) {
            const low = Math.min(startIdx, endIdx);
            const high = Math.max(startIdx, endIdx);

            if (!modifiers.ctrlKey && !modifiers.metaKey) {
                // Additive
            }
            
            for (let i = low; i <= high; i++) {
                newSelected.add(visibleKeys[i]);
            }
        } else {
             newSelected.add(key);
             setLastSelectedKey(key);
        }
    } else if (modifiers.ctrlKey || modifiers.metaKey) {
        if (newSelected.has(key)) {
            newSelected.delete(key);
        } else {
            newSelected.add(key);
        }
        setLastSelectedKey(key);
    } else {
        newSelected.clear();
        newSelected.add(key);
        setLastSelectedKey(key);
    }

    setSelectedKeys(newSelected);
  };

  const handleClearSelection = () => {
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
  };

  const handleResetAll = () => {
    setAssetOverrides(new Map());
    setLocalScaleOverrides(new Set());
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
  };

  const handleSaveConfig = () => {
    const config: OptimizerConfig = {
      version: 1,
      timestamp: new Date().toISOString(),
      overrides: Array.from(assetOverrides.entries()),
      localOverrides: Array.from(localScaleOverrides),
      selections: Array.from(selectedKeys),
      trackList,
      skinDocs,
      eventDocs,
      boneDocs,
      generalNotes,
      safetyBuffer: optimizationBuffer
    };
    
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const dateStr = new Date().toISOString().slice(0, 10);
    let downloadName = `spine-optimizer-config-${dateStr}.json`;
    if (loadedSkeletons.size === 1) {
        const first = loadedSkeletons.values().next().value;
        if (first) {
            downloadName = `spine-optimizer-config-${first.id}-${dateStr}.json`;
        }
    }

    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string) as OptimizerConfig;
        
        if (json.overrides && Array.isArray(json.overrides)) {
          setAssetOverrides(new Map(json.overrides));
        }
        if (json.localOverrides && Array.isArray(json.localOverrides)) {
          setLocalScaleOverrides(new Set(json.localOverrides));
        }
        if (json.selections && Array.isArray(json.selections)) {
          setSelectedKeys(new Set(json.selections));
        }

        if (json.trackList && Array.isArray(json.trackList)) {
            setTrackList(json.trackList);
        }
        if (json.skinDocs && Array.isArray(json.skinDocs)) {
            setSkinDocs(json.skinDocs);
        }
        if (json.eventDocs && Array.isArray(json.eventDocs)) {
            setEventDocs(json.eventDocs);
        }
        if (json.boneDocs && Array.isArray(json.boneDocs)) {
            setBoneDocs(json.boneDocs);
        }
        if (typeof json.generalNotes === 'string') {
            setGeneralNotes(json.generalNotes);
        }
        if (typeof json.safetyBuffer === 'number') {
            setOptimizationBuffer(json.safetyBuffer);
        }
        
        e.target.value = ''; 
        alert("Configuration loaded successfully.");
      } catch (err) {
        console.error("Failed to parse config", err);
        alert("Invalid configuration file.");
      }
    };
    reader.readAsText(file);
  };

  const handleOverrideClick = (asset: {lookupKey: string, path: string, overridePercentage?: number}) => {
    setSelectedAssetForOverride(asset);
    setOverrideModalOpen(true);
  };

  const handleLocalOverride = (animationName: string, lookupKey: string) => {
    setLocalScaleOverrides(prev => {
      const next = new Set<string>(prev);
      const key = `${animationName}|${lookupKey}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleToggleExpandAll = () => {
    setAllExpanded(prev => !prev);
  };

  const handleSort = (key: SortKey) => {
    setSortConfig(current => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      if (key === 'originalSize' || key === 'maxRenderSize') {
          return { key, direction: 'desc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const handleAnimationDeepLink = (animName: string, skeletonName?: string, assetKey?: string) => {
    setExpandTrigger({ 
      name: animName, 
      skeletonName: skeletonName || "Unknown Skeleton", 
      assetKey,
      ts: Date.now() 
    });
    
    setTimeout(() => {
        let el: HTMLDivElement | undefined;
        if (skeletonName) {
           el = animationRefs.current.get(`${skeletonName}-${animName}`);
        }
        if (!el) {
           el = animationRefs.current.get(animName);
        }

        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 50);
  };

  const applyOverride = (percentage: number) => {
    if (!selectedAssetForOverride) return;
    const targets = new Set<string>();
    
    if (selectedKeys.has(selectedAssetForOverride.lookupKey) && selectedKeys.size > 0) {
      selectedKeys.forEach(k => targets.add(k));
    } else {
      targets.add(selectedAssetForOverride.lookupKey);
    }

    const newOverrides = new Map<string, number>(assetOverrides);
    targets.forEach(key => {
       if (percentage > 0) {
        newOverrides.set(key, percentage);
      } else {
        newOverrides.delete(key);
      }
    });

    setAssetOverrides(newOverrides);
  };

  const filteredResults = useMemo(() => {
    if (!report) return [];
    const results = report.animations;
    
    if (!debouncedSearchTerm.trim()) return results;
    const term = debouncedSearchTerm.toLowerCase();
    
    const isOverrideSearch = term.length >= 2 && 'override'.startsWith(term);
    const isSkinSearch = term.length >= 2 && 'skin'.startsWith(term);
    
    return results.filter(result => {
      if (result.animationName?.toLowerCase().includes(term)) return true;
      if (result.skeletonName && result.skeletonName.toLowerCase().includes(term)) return true;
      
      const assetMatch = (img: any) => {
        const textMatch = img.path?.toLowerCase().includes(term) || img.bonePath?.toLowerCase().includes(term);
        const overrideMatch = isOverrideSearch && (!!img.isLocalScaleOverridden || !!img.isOverridden);
        const skinMatch = isSkinSearch && !!img.showSkinLabel;
        return textMatch || overrideMatch || skinMatch;
      };

      const hasMatchingFound = result.foundImages.some(assetMatch);
      if (hasMatchingFound) return true;
      
      const hasMatchingMissing = result.missingImages.some(assetMatch);
      if (hasMatchingMissing) return true;
      
      return false;
    });
  }, [report, debouncedSearchTerm]);

  const groupedResults = useMemo(() => {
    const groups = new Map<string, AnalysisResult[]>();
    filteredResults.forEach(res => {
      const key = res.skeletonName || "Unknown Skeleton";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(res);
    });
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredResults]);

  const filteredGlobalStats = useMemo(() => {
    if (!report) return [];
    let stats = report.globalStats;
    
    if (debouncedSearchTerm.trim()) {
      const term = debouncedSearchTerm.toLowerCase();
      const isOverrideSearch = term.length >= 2 && 'override'.startsWith(term);
      const isSkinSearch = term.length >= 2 && 'skin'.startsWith(term);
      
      stats = stats.filter(stat => {
        const textMatch = stat.path?.toLowerCase().includes(term) || stat.sourceAnimation?.toLowerCase().includes(term);
        const skeletonMatch = stat.sourceSkeleton ? stat.sourceSkeleton.toLowerCase().includes(term) : false;
        const overrideMatch = isOverrideSearch && stat.isOverridden;
        const skinMatch = isSkinSearch && (!!stat.skinName && stat.skinName !== 'default');

        return textMatch || skeletonMatch || overrideMatch || skinMatch;
      });
    }

    return [...stats].sort((a, b) => {
      let res = 0;
      switch (sortConfig.key) {
          case 'path':
              res = (a.path || '').localeCompare(b.path || '');
              break;
          case 'sourceAnimation':
              res = (a.sourceAnimation || '').localeCompare(b.sourceAnimation || '');
              break;
          case 'sourceSkeleton':
              res = (a.sourceSkeleton || '').localeCompare(b.sourceSkeleton || '');
              break;
          case 'originalSize':
              res = (a.originalWidth * a.originalHeight) - (b.originalWidth * b.originalHeight);
              break;
          case 'maxRenderSize':
              res = (a.maxRenderWidth * a.maxRenderHeight) - (b.maxRenderWidth * b.maxRenderHeight);
              break;
          default:
              res = 0;
      }
      return sortConfig.direction === 'asc' ? res : -res;
    });
  }, [report, debouncedSearchTerm, sortConfig]);

  const allMatches = useMemo((): SearchMatch[] => {
    if (!debouncedSearchTerm.trim() || !report) return [];
    const matches: SearchMatch[] = [];
    const term = debouncedSearchTerm.toLowerCase();

    // 1. Matches in Global Stats
    filteredGlobalStats.forEach(stat => {
      matches.push({ type: 'global', key: stat.lookupKey });
    });

    // 2. Matches in Animations
    report.animations.forEach(anim => {
      const assetMatch = (img: any) => {
        const textMatch = img.path?.toLowerCase().includes(term) || img.bonePath?.toLowerCase().includes(term);
        return textMatch;
      };

      // Check if animation name matches
      const animNameMatch = anim.animationName?.toLowerCase().includes(term);
      
      // If anim matches, we could add it, but requirement says cycle assets.
      // We add each matching asset found in this animation.
      anim.foundImages.filter(assetMatch).forEach(img => {
        matches.push({ type: 'anim', key: img.lookupKey, animName: anim.animationName, skeletonName: anim.skeletonName });
      });
      anim.missingImages.filter(assetMatch).forEach(img => {
        // Corrected: use img.path as key for missing images as they lack lookupKey
        matches.push({ type: 'anim', key: img.path, animName: anim.animationName, skeletonName: anim.skeletonName });
      });
    });

    return matches;
  }, [debouncedSearchTerm, report, filteredGlobalStats]);

  const executeMatchFocus = (index: number) => {
    const match = allMatches[index];
    if (!match) return;

    if (match.type === 'global') {
      setFocusedGlobalKey(match.key);
      setExpandTrigger(null);
    } else if (match.type === 'anim') {
      setFocusedGlobalKey(null);
      handleAnimationDeepLink(match.animName!, match.skeletonName, match.key);
    }
  };

  const handleNextMatch = () => {
    if (allMatches.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % allMatches.length;
    setCurrentMatchIndex(nextIdx);
    executeMatchFocus(nextIdx);
  };

  const handlePrevMatch = () => {
    if (allMatches.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + allMatches.length) % allMatches.length;
    setCurrentMatchIndex(prevIdx);
    executeMatchFocus(prevIdx);
  };

  const missingAssets = useMemo(() => {
    if (!report) return [];
    const missing = new Set<string>();
    report.animations.forEach(anim => {
      anim.missingImages.forEach(img => missing.add(img.path));
    });
    return Array.from(missing).sort();
  }, [report]);

  const batchCount = selectedAssetForOverride && selectedKeys.has(selectedAssetForOverride.lookupKey) 
    ? selectedKeys.size 
    : 0;

  const hasUserChanges = assetOverrides.size > 0 || localScaleOverrides.size > 0 || selectedKeys.size > 0;

  const activeImageCount = processedAssets.size;

  return (
    <div className="min-h-screen p-6 text-gray-100 bg-gray-900 md:p-12">
      <header className="max-w-5xl mx-auto mb-12 text-center">
        <h1 className="mb-3 text-4xl font-bold tracking-tight text-white md:text-5xl">
          Spine Asset <span className="text-spine-accent">Optimizer</span> <span className="text-2xl opacity-50 font-mono">v1.1</span>
        </h1>
        <p className="text-lg text-gray-400">
          Drop your Spine files to optimize assets, verify resolutions, and generate structured documentation for development teams.
        </p>
      </header>

      <main className="max-w-5xl mx-auto space-y-8">
        <DropZone 
          onFilesLoaded={handleFilesLoaded}
          onClear={handleClearAssets}
          stats={{
            json: loadedSkeletons.size > 0 ? (loadedSkeletons.size === 1 ? loadedSkeletons.values().next().value?.file.name : `${loadedSkeletons.size} Skeletons`) : undefined,
            images: activeImageCount,
            atlasCount: atlasCount
          }}
        />

        {report && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {report.isCanonicalDataMissing && (
              <div className="mb-6 p-4 border border-orange-500/50 bg-orange-900/20 rounded-lg flex items-start gap-4 animate-in fade-in slide-in-from-top-2">
                <AlertTriangle className="text-orange-500 shrink-0 mt-0.5" size={24} />
                <div>
                  <h3 className="text-orange-200 font-bold mb-1">WARNING: Optimization Data Incomplete</h3>
                  <p className="text-sm text-orange-300/80 leading-relaxed">
                    One or more loaded skeletons appear to be missing original size data (width/height) for some assets. 
                    This is usually caused by unchecking the <strong className="text-orange-200">Nonessential data</strong> box during the Spine export process. 
                    Calculations may be incorrect.
                  </p>
                </div>
              </div>
            )}

            <div className="sticky top-0 z-40 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800 px-4 py-4 space-y-4">
              {/* Row 1: Title & Search */}
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Activity className="text-spine-accent" />
                  <h2 className="text-xl font-semibold">Animation Breakdown</h2>
                  <div className="flex items-center gap-2 px-3 py-1 ml-2 text-xs font-medium text-gray-400 rounded-full bg-gray-800/50">
                    <Layers size={14} />
                    <span>
                      {filteredResults.length !== report.animations.length 
                        ? `${filteredResults.length} of ${report.animations.length} Animations`
                        : `${report.animations.length} Animations`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center bg-gray-800/50 border border-gray-700 rounded-lg shadow-sm focus-within:border-spine-accent/50 focus-within:ring-1 focus-within:ring-spine-accent/50 transition-all w-full md:w-[26rem]">
                  <div className="flex items-center px-3 text-gray-500">
                      <Search size={16} />
                  </div>
                  <input
                      type="text"
                      placeholder="Search assets..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="bg-transparent py-2 text-sm text-gray-200 focus:outline-none placeholder:text-gray-600 flex-1 min-w-[120px]"
                  />
                  
                  {debouncedSearchTerm && allMatches.length > 0 && (
                      <div className="flex items-center border-l border-gray-700 ml-2 py-1 pr-1 gap-1">
                         <span className="text-[10px] font-mono text-gray-500 px-2 whitespace-nowrap">
                            {currentMatchIndex + 1} of {allMatches.length}
                         </span>
                         <button 
                           onClick={handlePrevMatch}
                           className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                           title="Previous match"
                         >
                           <ChevronUp size={14} />
                         </button>
                         <button 
                           onClick={handleNextMatch}
                           className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                           title="Next match"
                         >
                           <ChevronDown size={14} />
                         </button>
                      </div>
                  )}

                  <div className="pr-1">
                      {searchTerm && (
                          <button 
                          onClick={() => setSearchTerm('')}
                          className="p-2 text-gray-500 hover:text-gray-300"
                          >
                          <X size={14} />
                          </button>
                      )}
                  </div>
                </div>
              </div>

              {/* Row 2: Action Toolbar */}
              <div className="flex flex-wrap items-center gap-3">
                 <div className="flex items-center bg-gray-800 h-10 p-1 rounded-lg border border-gray-700 shadow-sm">
                    <button
                        type="button"
                        onClick={handleSaveConfig}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors whitespace-nowrap"
                        title="Save Configuration"
                    >
                        <Download size={14} />
                        <span className="hidden sm:inline">Save</span>
                    </button>
                    <div className="w-px h-4 bg-gray-700 mx-1"></div>
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors whitespace-nowrap"
                        title="Load Configuration"
                    >
                        <Upload size={14} />
                        <span className="hidden sm:inline">Load</span>
                    </button>
                    <input 
                        ref={fileInputRef}
                        type="file" 
                        accept=".json" 
                        className="hidden" 
                        onChange={handleLoadConfig}
                    />
                 </div>

                 {hasUserChanges && (
                    <button 
                        type="button"
                        onClick={handleResetAll}
                        className="h-10 flex items-center gap-2 px-4 text-sm font-bold rounded-xl transition-all shadow-sm text-orange-100 bg-orange-900/80 border border-orange-500/50 hover:bg-orange-800 hover:border-orange-400 whitespace-nowrap"
                        title="Reset all overrides"
                    >
                        <RotateCcw size={16} />
                        <span>Reset</span>
                    </button>
                 )}

                 {selectedKeys.size > 0 && (
                    <button 
                        type="button"
                        onClick={handleClearSelection}
                        className="h-10 px-3 flex items-center gap-2 text-xs font-bold text-gray-300 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors whitespace-nowrap"
                    >
                        <CheckSquare size={14} className="text-spine-accent" />
                        <span>Clear ({selectedKeys.size})</span>
                    </button>
                 )}

                 <div className="flex-1" />

                 <div className="flex items-center gap-3 w-full md:w-[26rem]">
                    <button
                        type="button"
                        onClick={() => setIsTrackModalOpen(true)}
                        className="h-10 px-5 flex items-center justify-center flex-1 gap-2 text-sm font-bold text-gray-200 bg-gray-800 border border-gray-600 rounded-xl hover:bg-gray-700 hover:text-white hover:border-gray-500 transition-all shadow-sm group whitespace-nowrap"
                    >
                        <Film size={18} className="text-purple-400 group-hover:text-purple-300" />
                        <span>Documentation</span>
                    </button>

                    {report.animations.length > 0 && activeImageCount > 0 && (
                        <button
                            type="button"
                            onClick={handleOpenOptimization}
                            className="h-10 px-6 flex items-center justify-center flex-1 gap-2 text-sm font-bold text-white transition-all rounded-xl bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5 active:translate-y-0 whitespace-nowrap"
                        >
                            <Zap size={18} className="fill-current" />
                            <span>Optimize Assets</span>
                        </button>
                    )}
                 </div>
              </div>
            </div>

            {missingAssets.length > 0 && (
              <MissingAssetsCard missingPaths={missingAssets} />
            )}

            {report.unusedAssets.length > 0 && (
              <UnusedAssetsCard assets={report.unusedAssets} />
            )}

            <GlobalStatsSummary 
              stats={filteredGlobalStats} 
              selectedKeys={selectedKeys}
              onMultiSelect={handleSelectionAction}
              onOverrideClick={handleOverrideClick}
              sortConfig={sortConfig}
              onSort={handleSort}
              onAnimationClick={handleAnimationDeepLink}
              isMultiSkeleton={loadedSkeletons.size > 1}
              focusedKey={focusedGlobalKey}
            />

            <div className="space-y-4" onDoubleClick={handleToggleExpandAll} title="Double-click to toggle expand/collapse all">
              {filteredResults.length === 0 ? (
                <div className="p-12 text-center border border-dashed rounded-lg border-gray-800 bg-spine-card/20">
                  <p className="text-gray-500">
                    {searchTerm 
                      ? `No animations or assets found matching "${searchTerm}"` 
                      : "No animations found in the provided files."}
                  </p>
                  {searchTerm && (
                    <button 
                      onClick={() => setSearchTerm('')}
                      className="mt-4 text-sm text-spine-accent hover:underline"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                groupedResults.map(([skeletonName, items]) => (
                  <SkeletonGroup 
                    key={skeletonName} 
                    name={skeletonName} 
                    count={items.length}
                    globalExpanded={allExpanded}
                    searchTerm={debouncedSearchTerm}
                    expandTrigger={expandTrigger}
                  >
                    {items.map((result, idx) => (
                      <AnimationCard 
                        key={`${result.skeletonName}-${result.animationName}-${idx}`} 
                        result={result} 
                        searchTerm={debouncedSearchTerm}
                        onOverrideClick={handleOverrideClick}
                        selectedKeys={selectedKeys}
                        onMultiSelect={handleSelectionAction}
                        onLocalOverride={handleLocalOverride}
                        globalExpanded={allExpanded}
                        expandTrigger={expandTrigger}
                        setRef={(el) => {
                           const key = result.skeletonName ? `${result.skeletonName}-${result.animationName}` : result.animationName;
                           if (el) animationRefs.current.set(key, el);
                           else animationRefs.current.delete(key);
                        }}
                        showSkeletonLabel={false} 
                      />
                    ))}
                  </SkeletonGroup>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      <AnalysisProgressModal 
        isOpen={isAnalysisLoading} 
        statusText={analysisStatus} 
        progress={analysisProgress} 
      />

      <OptimizationModal 
        isOpen={isOptModalOpen}
        onClose={() => !isProcessingOpt && setIsOptModalOpen(false)}
        onConfirm={handleRunOptimization}
        onPreview={handleAtlasPreviewFromModal}
        tasks={optTasks}
        isProcessing={isProcessingOpt}
        progress={optProgress}
        buffer={optimizationBuffer}
        onBufferChange={handleBufferChange}
      />

      <PercentageOverrideModal
        isOpen={overrideModalOpen}
        onClose={() => setOverrideModalOpen(false)}
        onConfirm={applyOverride}
        initialValue={selectedAssetForOverride?.overridePercentage}
        assetPath={selectedAssetForOverride?.path || ""}
        batchCount={batchCount}
      />

      <AtlasPreviewModal 
        isOpen={isAtlasModalOpen}
        onClose={() => setIsAtlasModalOpen(false)}
        tasks={atlasTasks}
        missingImageCount={missingAssets.length}
      />

      <TrackConfigModal 
        isOpen={isTrackModalOpen}
        onClose={() => setIsTrackModalOpen(false)}
        availableAnimations={report?.animations.map(a => a.animationName).sort() || []}
        trackList={trackList}
        setTrackList={setTrackList}
        skinDocs={skinDocs}
        setSkinDocs={setSkinDocs}
        eventDocs={eventDocs}
        setEventDocs={setEventDocs}
        boneDocs={boneDocs}
        setBoneDocs={setBoneDocs}
        generalNotes={generalNotes}
        setGeneralNotes={setGeneralNotes}
        safetyBuffer={optimizationBuffer}
        resizedCount={optimizationStats.resizedCount}
        optimizationReduction={optimizationStats.reduction}
        projectedAtlasCount={optimizationStats.atlasCount}
        skeletonName={loadedSkeletons.size === 1 ? (loadedSkeletons.values().next().value?.id || "Skeleton") : `${loadedSkeletons.size} Skeletons`}
        totalImages={report?.globalStats.length || 0}
        totalAnimations={report?.animations.length || 0}
      />

      <ScrollToTop />
    </div>
  );
}