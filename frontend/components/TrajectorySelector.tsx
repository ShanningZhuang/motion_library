'use client';

import { useState, useEffect, useRef } from 'react';
import { trajectoryApi, TrajectoryMetadata } from '@/lib/api';
import { Upload } from 'lucide-react';

interface LoadedTrajectory {
  id: string;
  name: string;
  data: any;
  isGhost: boolean;
  visible?: boolean;
  startFrame?: number;
  source: 'server' | 'local';
  customFrameRate?: number;
  showMuscles?: boolean;
}

interface TrajectorySelectorProps {
  onTrajectorySelect: (trajectoryData: Blob, trajectory: TrajectoryMetadata) => void;
  selectedTrajectoryId?: string;
  onLocalFileSelect?: (file: File) => void;
  localUploadDisabled?: boolean;
  loadedTrajectories?: LoadedTrajectory[];
  onToggleGhost?: (id: string) => void;
  onToggleMuscles?: (id: string) => void;
  onToggleVisible?: (id: string) => void;
  onStartFrameChange?: (id: string, startFrame: number) => void;
  onFrameRateChange?: (id: string, frameRate: number) => void;
  onRemoveTrajectory?: (id: string) => void;
  currentFrame?: number;
  primaryFrameRate?: number;
}

interface CategoryGroup {
  categoryName: string;
  trajectories: TrajectoryMetadata[];
}

export default function TrajectorySelector({
  onTrajectorySelect,
  selectedTrajectoryId,
  onLocalFileSelect,
  localUploadDisabled = false,
  loadedTrajectories = [],
  onToggleGhost,
  onToggleMuscles,
  onToggleVisible,
  onStartFrameChange,
  onFrameRateChange,
  onRemoveTrajectory,
  currentFrame = 0,
  primaryFrameRate = 30,
}: TrajectorySelectorProps) {
  const [trajectories, setTrajectories] = useState<TrajectoryMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingTrajectoryId, setLoadingTrajectoryId] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [defaultCollapsed, setDefaultCollapsed] = useState(true);
  const [thumbnailUrls, setThumbnailUrls] = useState<Map<string, string>>(new Map());
  const [loadedCategories, setLoadedCategories] = useState<Set<string>>(new Set());
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMode, setUploadMode] = useState<'new' | 'existing'>('new');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadTrajectories();
  }, []);

  useEffect(() => {
    // Cleanup blob URLs on unmount
    return () => {
      thumbnailUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [thumbnailUrls]);

  const loadTrajectories = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await trajectoryApi.list();
      setTrajectories(response.trajectories);

      // Initialize all categories as collapsed if defaultCollapsed is true
      if (defaultCollapsed) {
        const categoryNames = new Set<string>();
        response.trajectories.forEach((trajectory) => {
          const categoryName = trajectory.category || 'Uncategorized';
          categoryNames.add(categoryName);
        });
        setCollapsedCategories(categoryNames);
        setDefaultCollapsed(false); // Only do this once
      }
    } catch (err) {
      setError('Failed to load trajectories');
      console.error('Error loading trajectories:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTrajectoryClick = async (trajectory: TrajectoryMetadata) => {
    console.log('[TRAJECTORY SELECTOR] Trajectory clicked:', trajectory.filename);
    try {
      setLoadingTrajectoryId(trajectory.id);
      setError(null);

      console.log('[TRAJECTORY SELECTOR] Fetching trajectory file from API...');
      // Fetch the trajectory data file
      const blob = await trajectoryApi.get(trajectory.id);
      console.log('[TRAJECTORY SELECTOR] Blob received:', { size: blob.size, type: blob.type });

      console.log('[TRAJECTORY SELECTOR] Calling onTrajectorySelect callback...');
      onTrajectorySelect(blob, trajectory);
      console.log('[TRAJECTORY SELECTOR] Callback completed');
    } catch (err) {
      setError('Failed to load trajectory file');
      console.error('[TRAJECTORY SELECTOR] Error loading trajectory file:', err);
    } finally {
      setLoadingTrajectoryId(null);
    }
  };

  const toggleCategory = (categoryName: string) => {
    setCollapsedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(categoryName)) {
        newSet.delete(categoryName);
        // Load thumbnails for this category when expanded
        loadCategoryThumbnails(categoryName);
      } else {
        newSet.add(categoryName);
      }
      return newSet;
    });
  };

  const loadCategoryThumbnails = async (categoryName: string) => {
    // Don't reload if already loaded
    if (loadedCategories.has(categoryName)) {
      return;
    }

    console.log('[TRAJECTORY SELECTOR] Loading thumbnails for category:', categoryName);

    // Get trajectories in this category
    const categoryTrajectories = trajectories.filter(
      t => (t.category || 'Uncategorized') === categoryName
    );

    const urlMap = new Map(thumbnailUrls);

    for (const trajectory of categoryTrajectories) {
      if (trajectory.thumbnail_path && !urlMap.has(trajectory.id)) {
        try {
          console.log('[TRAJECTORY SELECTOR] Preloading thumbnail for:', trajectory.id, trajectory.filename);
          const blob = await trajectoryApi.getThumbnail(trajectory.id);
          const blobUrl = URL.createObjectURL(blob);
          urlMap.set(trajectory.id, blobUrl);
          console.log('[TRAJECTORY SELECTOR] Thumbnail preloaded:', trajectory.id);
        } catch (err) {
          console.error('[TRAJECTORY SELECTOR] Failed to preload thumbnail:', trajectory.id, err);
        }
      }
    }

    setThumbnailUrls(urlMap);
    setLoadedCategories(prev => new Set(prev).add(categoryName));
  };

  // Group trajectories by category
  const groupTrajectories = (): CategoryGroup[] => {
    const categoryMap = new Map<string, TrajectoryMetadata[]>();

    trajectories.forEach((trajectory) => {
      const categoryName = trajectory.category || 'Uncategorized';

      if (!categoryMap.has(categoryName)) {
        categoryMap.set(categoryName, []);
      }
      categoryMap.get(categoryName)!.push(trajectory);
    });

    // Convert to array and sort by category name
    return Array.from(categoryMap.entries())
      .map(([categoryName, trajectories]) => ({ categoryName, trajectories }))
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  };

  // Get all unique categories
  const getAllCategories = (): string[] => {
    const categories = new Set<string>();
    trajectories.forEach((trajectory) => {
      if (trajectory.category) {
        categories.add(trajectory.category);
      }
    });
    return Array.from(categories).sort();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (file.name.endsWith('.npy') || file.name.endsWith('.npz'))) {
      setSelectedFile(file);
    } else if (file) {
      alert('请选择 .npy 或 .npz 文件');
      setSelectedFile(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      alert('请先选择文件');
      return;
    }

    let category: string | undefined;
    if (uploadMode === 'new') {
      if (!newCategoryName.trim()) {
        alert('请输入文件夹名称');
        return;
      }
      category = newCategoryName.trim();
    } else {
      if (!selectedCategory) {
        alert('请选择文件夹');
        return;
      }
      category = selectedCategory === 'Uncategorized' ? undefined : selectedCategory;
    }

    setUploading(true);
    try {
      await trajectoryApi.upload(selectedFile, category);
      // Reload trajectories
      await loadTrajectories();
      // Reset form
      setShowUploadModal(false);
      setSelectedFile(null);
      setNewCategoryName('');
      setSelectedCategory('');
      setUploadMode('new');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      alert('上传成功！');
    } catch (err) {
      console.error('Error uploading trajectory:', err);
      alert('上传失败: ' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setUploading(false);
    }
  };

  const openUploadModal = () => {
    setShowUploadModal(true);
    setSelectedFile(null);
    setNewCategoryName('');
    setSelectedCategory('');
    setUploadMode('new');
  };

  const closeUploadModal = () => {
    if (!uploading) {
      setShowUploadModal(false);
      setSelectedFile(null);
      setNewCategoryName('');
      setSelectedCategory('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Local file upload handlers
  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (file.name.endsWith('.npy') || file.name.endsWith('.npz'))) {
      onLocalFileSelect?.(file);
    } else if (file) {
      alert('Please select a .npy or .npz file');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!localUploadDisabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (localUploadDisabled) return;

    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.npy') || file.name.endsWith('.npz'))) {
      onLocalFileSelect?.(file);
    } else if (file) {
      alert('Please drop a .npy or .npz file');
    }
  };

  if (loading) {
    return (
      <div className="p-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between text-left"
        >
          <h3 className="text-lg font-semibold text-white">Trajectories</h3>
          <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
        </button>
        {isExpanded && (
          <div className="text-gray-400 text-sm mt-4">Loading trajectories...</div>
        )}
      </div>
    );
  }

  if (error && trajectories.length === 0) {
    return (
      <div className="p-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between text-left"
        >
          <h3 className="text-lg font-semibold text-white">Trajectories</h3>
          <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
        </button>
        {isExpanded && (
          <div className="mt-4">
        <div className="text-red-400 text-sm">{error}</div>
        <button
          type="button"
          onClick={loadTrajectories}
          className="mt-2 text-blue-400 hover:text-blue-300 text-sm"
        >
          Retry
        </button>
          </div>
        )}
      </div>
    );
  }

  const categoryGroups = groupTrajectories();

  const allCategories = getAllCategories();

  return (
    <div className="p-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <h3 className="text-lg font-semibold text-white">Trajectories</h3>
        <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* Server Trajectory Upload Button */}
          <div>
            <h4 className="text-xs font-medium text-gray-400 mb-2">Server Trajectories</h4>
        <button
          type="button"
          onClick={openUploadModal}
              className="w-full flex items-center justify-center gap-1 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
        >
          <Upload className="w-4 h-4" />
              Upload to Server
        </button>
      </div>

      {error && (
            <div className="text-red-400 text-xs bg-red-900 bg-opacity-20 p-2 rounded">
          {error}
        </div>
      )}

          {/* Local Trajectory Upload */}
          {onLocalFileSelect && (
            <div>
              <h4 className="text-xs font-medium text-gray-400 mb-2">Local Upload</h4>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !localUploadDisabled && localFileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-lg p-4 text-center cursor-pointer
                  transition-colors
                  ${isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 hover:border-gray-500'}
                  ${localUploadDisabled ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <Upload className="w-6 h-6 mx-auto mb-2 text-gray-400" />
                <p className="text-xs text-gray-400">
                  Drop .npy/.npz file or click
                </p>
              </div>
              <input
                ref={localFileInputRef}
                type="file"
                accept=".npy,.npz"
                onChange={handleLocalFileChange}
                className="hidden"
                disabled={localUploadDisabled}
              />
            </div>
          )}

          {/* Loaded Trajectories List */}
          {loadedTrajectories && loadedTrajectories.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-400 mb-2">
                Loaded Trajectories ({loadedTrajectories.length})
              </h4>
              <div className="space-y-2">
                {loadedTrajectories.map(traj => {
                  const frameCount = traj.data?.frameCount || 0;
                  const startFrame = traj.startFrame || 0;
                  const frameRate = traj.customFrameRate || traj.data?.frameRate || 30;
                  const isVisible = traj.visible !== false;
                  
                  // Calculate current trajectory frame using time-based synchronization
                  // 1. Calculate start time based on startFrame
                  const startTime = startFrame / frameRate;
                  
                  // 2. Convert global currentFrame to time using primary frame rate
                  const currentTime = currentFrame / primaryFrameRate;
                  
                  // 3. Calculate trajectory time
                  const trajectoryTime = currentTime + startTime;
                  
                  // 4. Convert time back to trajectory frame based on trajectory's frame rate
                  const currentTrajectoryFrame = Math.min(
                    Math.max(0, Math.floor(trajectoryTime * frameRate)),
                    frameCount - 1
                  );
                  
                  return (
                    <div key={traj.id} className="p-2 bg-gray-700 rounded space-y-2">
                      {/* 第一行：控制按钮和名称 */}
                      <div className="flex items-center gap-2">
                        {/* View 按钮 */}
                        <button
                          onClick={() => onToggleVisible?.(traj.id)}
                          className={`px-2 py-1 text-xs rounded transition-colors ${
                            isVisible
                              ? 'bg-green-600 hover:bg-green-700 text-white'
                              : 'bg-gray-600 hover:bg-gray-500 text-gray-300'
                          }`}
                          title={isVisible ? 'Hide trajectory' : 'Show trajectory'}
                        >
                          View
                        </button>
                        
                        {/* Ghost 按钮 */}
                        <button
                          onClick={() => onToggleGhost?.(traj.id)}
                          className={`px-2 py-1 text-xs rounded transition-colors ${
                            traj.isGhost
                              ? 'bg-blue-600 hover:bg-blue-700 text-white'
                              : 'bg-gray-600 hover:bg-gray-500 text-gray-300'
                          }`}
                          title={traj.isGhost ? 'Disable ghost mode' : 'Enable ghost mode (semi-transparent)'}
                        >
                          Ghost
                        </button>

                        {/* Muscles 按钮 */}
                        <button
                          onClick={() => onToggleMuscles?.(traj.id)}
                          className={`px-2 py-1 text-xs rounded transition-colors ${
                            traj.showMuscles
                              ? 'bg-purple-600 hover:bg-purple-700 text-white'
                              : 'bg-gray-600 hover:bg-gray-500 text-gray-300'
                          }`}
                          title={traj.showMuscles ? 'Hide muscles/tendons' : 'Show muscles/tendons'}
                        >
                          Muscle
                        </button>

                    {/* Trajectory name */}
                    <span className="flex-1 text-xs text-gray-200 truncate" title={traj.name}>
                      {traj.name}
                    </span>

                    {/* Source badge */}
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      traj.source === 'server' ? 'bg-blue-600' : 'bg-green-600'
                    }`}>
                      {traj.source}
                    </span>

                    {/* Remove button */}
                    <button
                      onClick={() => onRemoveTrajectory?.(traj.id)}
                      className="text-red-400 hover:text-red-300 text-sm"
                      title="Remove trajectory"
                    >
                      ✕
                    </button>
                  </div>

                      {/* 第二行：Timeline Slider */}
                      {frameCount > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                            {/* 可编辑帧率 */}
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="1000"
                                step="1"
                                value={Math.round(frameRate)}
                                onChange={(e) => {
                                  const newFrameRate = parseInt(e.target.value, 10);
                                  if (!isNaN(newFrameRate) && newFrameRate >= 1 && newFrameRate <= 1000) {
                                    onFrameRateChange?.(traj.id, newFrameRate);
                                  }
                                }}
                                className="w-14 px-1 py-0.5 bg-gray-600 text-white text-xs rounded border border-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                title="Edit frame rate (1-1000 fps)"
                              />
                              <span>fps</span>
                            </div>
                            <span>Start: Frame {startFrame + 1} / {frameCount}</span>
                          </div>
                          
                          {/* Timeline Slider - 和PlaybackControls一样的样式 */}
                          <div className="relative">
                            <input
                              type="range"
                              min="0"
                              max={frameCount - 1}
                              value={startFrame}
                              onChange={(e) => {
                                const newStartFrame = parseInt(e.target.value, 10);
                                onStartFrameChange?.(traj.id, newStartFrame);
                              }}
                              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                              style={{
                                background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(startFrame / Math.max(frameCount - 1, 1)) * 100}%, #4b5563 ${(startFrame / Math.max(frameCount - 1, 1)) * 100}%, #4b5563 100%)`
                              }}
                              title="Drag to set start frame"
                            />
                            <div className="flex justify-between text-xs text-gray-400 mt-1">
                              <span>Frame 1</span>
                              <span>Current: {Math.floor(currentTrajectoryFrame) + 1}</span>
                              <span>Frame {frameCount}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={closeUploadModal}
        >
          <div 
            className="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-semibold text-white mb-4">上传轨迹文件</h2>

            {/* Folder Selection Mode */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                选择文件夹
              </label>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setUploadMode('new')}
                  className={`flex-1 px-4 py-2 rounded transition-colors ${
                    uploadMode === 'new'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  新建文件夹
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode('existing')}
                  className={`flex-1 px-4 py-2 rounded transition-colors ${
                    uploadMode === 'existing'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  使用已有文件夹
                </button>
              </div>

              {uploadMode === 'new' ? (
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="输入新文件夹名称"
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">选择文件夹</option>
                  {allCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* File Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                选择文件
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".npy,.npz"
                onChange={handleFileSelect}
                className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
              />
              {selectedFile && (
                <p className="mt-2 text-sm text-gray-400">
                  已选择: {selectedFile.name}
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={closeUploadModal}
                disabled={uploading}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading || !selectedFile}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? '上传中...' : '上传'}
              </button>
            </div>
          </div>
        </div>
      )}

      {trajectories.length === 0 ? (
        <div className="text-gray-400 text-sm">No trajectories available</div>
      ) : (
        <div className="space-y-3">
          {categoryGroups.map((group) => {
            const isCollapsed = collapsedCategories.has(group.categoryName);

            return (
              <div key={group.categoryName} className="space-y-2">
                {/* Category Header */}
                <button
                  type="button"
                  onClick={() => toggleCategory(group.categoryName)}
                  className="w-full flex items-center gap-2 p-2 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                >
                  {/* Arrow icon */}
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      isCollapsed ? '-rotate-90' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                  <span className="text-sm font-medium text-gray-200">
                    {group.categoryName}
                  </span>
                  <span className="text-xs text-gray-400">
                    ({group.trajectories.length})
                  </span>
                </button>

                {/* Trajectories in category */}
                {!isCollapsed && (
                  <div className="grid grid-cols-2 gap-2">
                    {group.trajectories.map((trajectory) => {
                      const isSelected = trajectory.id === selectedTrajectoryId;
                      const isLoading = trajectory.id === loadingTrajectoryId;

                      return (
                        <button
                          key={trajectory.id}
                          type="button"
                          onClick={() => handleTrajectoryClick(trajectory)}
                          disabled={isLoading}
                          className={`
                            w-full text-left p-3 rounded transition-colors
                            ${
                              isSelected
                                ? 'bg-blue-600 bg-opacity-30 border border-blue-500'
                                : 'bg-gray-700 hover:bg-gray-600 border border-transparent'
                            }
                            ${isLoading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
                          `}
                        >
                          <div className="flex flex-col gap-2">
                            {/* Thumbnail preview */}
                            <div className="w-full aspect-square bg-gray-600 rounded overflow-hidden">
                              {thumbnailUrls.get(trajectory.id) ? (
                                <img
                                  src={thumbnailUrls.get(trajectory.id)}
                                  alt={trajectory.filename}
                                  className="w-full h-full object-cover"
                                />
                              ) : trajectory.thumbnail_path ? (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                  Loading...
                                </div>
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                  No preview
                                </div>
                              )}
                            </div>

                            {/* Info section */}
                            <div className="flex flex-col gap-1">
                              <div className="text-xs text-gray-200 font-medium break-words">
                                {trajectory.filename}
                              </div>
                              {isLoading && (
                                <div className="text-xs text-blue-400">Loading...</div>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
