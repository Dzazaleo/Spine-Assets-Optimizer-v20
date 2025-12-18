
import React, { useState, useEffect, useMemo } from 'react';
import { OptimizationTask } from '../types';
import { resizeImage, generateOptimizedZip, detectBatchAlphaMode } from '../utils/optimizer';
import { X, ArrowRight, Download, Loader2, Copy, Shield, Map as MapIcon, Layers, Search } from 'lucide-react';
import clsx from 'clsx';

interface OptimizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onPreview: () => void;
  tasks: OptimizationTask[];
  isProcessing: boolean;
  progress: { current: number, total: number };
  buffer: number;
  onBufferChange: (val: number) => void;
}

export const OptimizationModal: React.FC<OptimizationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  onPreview,
  tasks,
  isProcessing,
  progress,
  buffer,
  onBufferChange
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [detectedAlpha, setDetectedAlpha] = useState<string>("Scanning...");

  const filteredTasks = useMemo(() => {
    if (!searchTerm.trim()) return tasks;
    const term = searchTerm.toLowerCase();
    return tasks.filter(t => 
      t.fileName.toLowerCase().includes(term) || 
      t.relativePath.toLowerCase().includes(term)
    );
  }, [tasks, searchTerm]);

  useEffect(() => {
    if (isOpen && tasks.length > 0) {
        setDetectedAlpha("Scanning...");
        // Check first image as representative of batch
        detectBatchAlphaMode(tasks[0].blob).then(setDetectedAlpha);
    }
  }, [isOpen, tasks]);

  if (!isOpen) return null;

  const resizeTasks = tasks.filter(t => t.isResize);

  const totalOriginalPixels = tasks.reduce((acc, t) => acc + (t.originalWidth * t.originalHeight), 0);
  const totalTargetPixels = tasks.reduce((acc, t) => acc + (t.targetWidth * t.targetHeight), 0);
  const reduction = totalOriginalPixels > 0 
    ? ((totalOriginalPixels - totalTargetPixels) / totalOriginalPixels * 100).toFixed(1)
    : "0";

  const handleRowClick = (task: OptimizationTask, e: React.MouseEvent) => {
    const path = task.relativePath;
    const newSelected = new Set(selectedPaths);

    if (e.shiftKey && lastSelectedPath !== null) {
      const start = filteredTasks.findIndex(t => t.relativePath === lastSelectedPath);
      const end = filteredTasks.findIndex(t => t.relativePath === path);
      
      if (start !== -1 && end !== -1) {
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        
        if (!e.ctrlKey && !e.metaKey) {
          newSelected.clear();
        }
        
        for (let i = min; i <= max; i++) {
          newSelected.add(filteredTasks[i].relativePath);
        }
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (newSelected.has(path)) {
        newSelected.delete(path);
      } else {
        newSelected.add(path);
      }
      setLastSelectedPath(path);
    } else {
      newSelected.clear();
      newSelected.add(path);
      setLastSelectedPath(path);
    }

    setSelectedPaths(newSelected);
  };

  const handleDownloadSingle = async (task: OptimizationTask) => {
    let blobToDownload = task.blob;
    
    // If resizing is required, perform it on the fly for this single asset
    if (task.isResize) {
      const resized = await resizeImage(task.blob, task.targetWidth, task.targetHeight);
      if (resized) {
        blobToDownload = resized;
      }
    }

    // Trigger download
    const url = URL.createObjectURL(blobToDownload);
    const a = document.createElement('a');
    a.href = url;
    a.download = task.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAction = async (e: React.MouseEvent, task: OptimizationTask) => {
    e.stopPropagation();

    // Check if we are in batch mode
    // (Clicked row is selected AND there are multiple selected items)
    if (selectedPaths.has(task.relativePath) && selectedPaths.size > 1) {
        if (batchProcessing) return;
        setBatchProcessing(true);

        try {
            // We use the global task list to allow batch download of all selected items
            const selectedTasks = tasks.filter(t => selectedPaths.has(t.relativePath));
            
            // Reuse the existing zip generator logic
            // We pass a no-op for progress since this is a sub-action
            const blob = await generateOptimizedZip(selectedTasks, () => {});
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `optimized_assets_batch_${selectedTasks.length}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Batch download failed", error);
            alert("Failed to create batch zip.");
        } finally {
            setBatchProcessing(false);
        }
    } else {
        // Fallback to single download
        await handleDownloadSingle(task);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden border border-gray-700 rounded-xl bg-spine-dark shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700 bg-gray-800/50">
          <div className="flex flex-col gap-1">
            <h3 className="text-xl font-semibold text-white">Optimize Assets</h3>
            {!isProcessing && (
              <p className="text-xs text-gray-400">Review and filter assets before generation.</p>
            )}
          </div>
          {!isProcessing && (
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X size={24} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {isProcessing ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="w-12 h-12 text-spine-accent animate-spin" />
              <p className="text-lg text-gray-300">Processing image {progress.current} of {progress.total}...</p>
              <div className="w-64 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-spine-accent transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              {/* Search Bar */}
              <div className="relative mb-4 group">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-500 group-focus-within:text-spine-accent transition-colors">
                  <Search size={16} />
                </div>
                <input
                  type="text"
                  placeholder="Filter by filename or path..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full py-2.5 pl-10 pr-10 text-sm text-gray-200 transition-all border border-gray-700 rounded-lg bg-gray-900/50 focus:outline-none focus:ring-1 focus:ring-spine-accent/50 focus:border-spine-accent/50 placeholder:text-gray-600 focus:bg-gray-900"
                />
                {searchTerm && (
                  <button 
                    onClick={() => setSearchTerm('')}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-300"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Batch Format Badge */}
              <div className="flex items-center justify-between bg-gray-900 p-3 rounded mb-4 border border-gray-700">
                  <div className="flex items-center gap-2">
                      <div className={clsx("w-2 h-2 rounded-full", detectedAlpha.includes('Straight') ? 'bg-yellow-400' : 'bg-green-400 animate-pulse')}></div>
                      <span className="text-gray-400 text-sm">Detected Batch Format:</span>
                  </div>
                  <span className={`text-sm font-bold font-mono px-2 py-0.5 rounded ${detectedAlpha.includes('Straight') ? 'text-yellow-400 bg-yellow-900/20 border border-yellow-900/30' : 'text-green-400 bg-green-900/20 border border-green-900/30'}`}>
                      {detectedAlpha}
                  </span>
              </div>

              <div className="flex items-center justify-between mb-6 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                 <div className="flex items-center gap-3">
                    <Shield className="text-spine-accent" size={24} />
                    <div>
                       <h4 className="text-sm font-bold text-gray-200">Safety Buffer</h4>
                       <p className="text-xs text-gray-400">Increase target resolution to allow for runtime scaling.</p>
                    </div>
                 </div>
                 <div className="flex items-center gap-2">
                    <input 
                      type="number" 
                      min="0" 
                      max="100"
                      value={buffer}
                      onChange={(e) => onBufferChange(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-20 px-3 py-1 text-right bg-gray-900 border border-gray-600 rounded text-white focus:border-spine-accent focus:outline-none"
                    />
                    <span className="text-gray-400">%</span>
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-4 bg-blue-900/20 border border-blue-800/50 rounded-lg">
                  <p className="text-blue-200 text-sm">
                    <span className="block text-lg font-bold text-white mb-1">{tasks.length} Used Files</span>
                    Includes used assets only. Unused files are excluded.
                  </p>
                </div>
                <div className="p-4 bg-green-900/20 border border-green-800/50 rounded-lg">
                  <p className="text-green-200 text-sm">
                    <span className="block text-lg font-bold text-white mb-1">{resizeTasks.length} to Resize</span>
                    Saving est. <span className="font-bold text-green-400">{reduction}%</span> pixels.
                  </p>
                </div>
              </div>

              <div className="space-y-2 select-none">
                <div className="grid grid-cols-12 gap-4 pb-2 text-xs font-semibold text-gray-500 uppercase px-3">
                  <div className="col-span-1 text-center">Action</div>
                  <div className="col-span-6">Asset Path</div>
                  <div className="col-span-5 text-right">Transformation</div>
                </div>
                
                {filteredTasks.length === 0 ? (
                  <div className="py-12 text-center text-gray-500 italic">
                    No assets matching "{searchTerm}"
                  </div>
                ) : (
                  filteredTasks.map((task, idx) => {
                    const isSelected = selectedPaths.has(task.relativePath);
                    const isBatchTarget = isSelected && selectedPaths.size > 1;

                    return (
                      <div 
                        key={task.relativePath} 
                        onClick={(e) => handleRowClick(task, e)}
                        className={clsx(
                          "grid grid-cols-12 gap-4 items-center px-3 py-2 text-sm rounded border cursor-pointer transition-colors",
                          isSelected 
                            ? "bg-spine-accent/20 border-spine-accent/50 hover:bg-spine-accent/30" 
                            : "bg-gray-800/30 border-gray-700/50 hover:bg-gray-800/60"
                        )}
                      >
                        <div className="col-span-1 flex justify-center">
                          <button 
                            onClick={(e) => handleDownloadAction(e, task)}
                            disabled={batchProcessing && isBatchTarget}
                            className="transition-transform active:scale-95 hover:scale-110 focus:outline-none"
                            title={isBatchTarget ? `Download Selected Batch (${selectedPaths.size} items)` : task.isResize ? `Download Optimized ${task.fileName}` : `Download Original ${task.fileName}`}
                          >
                            {batchProcessing && isBatchTarget ? (
                               <Loader2 size={14} className="text-spine-accent animate-spin" />
                            ) : isBatchTarget ? (
                               <div className="p-1.5 bg-spine-accent/20 rounded-full text-spine-accent border border-spine-accent/30">
                                 <Layers size={14} />
                               </div>
                            ) : task.isResize ? (
                               <div className="p-1.5 bg-green-500/20 rounded-full text-green-400">
                                 <Download size={14} />
                               </div>
                            ) : (
                              <div className="p-1.5 bg-gray-600/20 rounded-full text-gray-400">
                                 <Copy size={14} />
                               </div>
                            )}
                          </button>
                        </div>
                        <div className="col-span-6 min-w-0">
                          <div className={clsx("truncate font-medium", isSelected ? "text-white" : "text-gray-300")} title={task.fileName}>
                            {task.fileName}
                          </div>
                          <div className={clsx("truncate text-[10px] font-mono mt-0.5", isSelected ? "text-gray-300" : "text-gray-500")} title={task.relativePath}>
                            {task.relativePath}
                          </div>
                        </div>
                        <div className="col-span-5 flex items-center justify-end gap-2 font-mono text-xs">
                          <span className={clsx(isSelected ? "text-gray-300" : "text-gray-400")}>{task.originalWidth}x{task.originalHeight}</span>
                          {task.isResize ? (
                            <>
                              <ArrowRight size={12} className={clsx(isSelected ? "text-green-300" : "text-green-500")} />
                              <span className={clsx("font-bold", isSelected ? "text-green-300" : "text-green-400")}>{task.targetWidth}x{task.targetHeight}</span>
                            </>
                          ) : (
                            <span className={clsx("text-[10px] uppercase tracking-wider ml-2", isSelected ? "text-gray-300" : "text-gray-600")}>Copy</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!isProcessing && (
          <div className="flex justify-end gap-3 p-6 border-t border-gray-700 bg-gray-800/50">
            <div className="mr-auto flex items-center gap-3">
                <button
                onClick={onPreview}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-200 bg-blue-900/20 border border-blue-800/50 rounded-lg hover:bg-blue-900/40 transition-colors"
                >
                <MapIcon size={16} />
                Atlas Preview
                </button>
                {selectedPaths.size > 0 && (
                     <span className="text-xs text-gray-500 font-mono">
                         {selectedPaths.size} selected
                     </span>
                )}
            </div>

            <button 
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:text-white"
            >
              Cancel
            </button>
            <button 
              onClick={onConfirm}
              className="flex items-center gap-2 px-6 py-2 text-sm font-bold text-white transition-all rounded-lg bg-spine-accent hover:bg-red-500 shadow-lg shadow-red-900/20"
            >
              <Download size={18} />
              Generate Optimized Output
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
