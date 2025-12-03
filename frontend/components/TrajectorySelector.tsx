'use client';

import { useState, useEffect } from 'react';
import { trajectoryApi, TrajectoryMetadata } from '@/lib/api';

interface TrajectorySelectorProps {
  onTrajectorySelect: (trajectoryData: Blob, trajectory: TrajectoryMetadata) => void;
  selectedTrajectoryId?: string;
}

interface CategoryGroup {
  categoryName: string;
  trajectories: TrajectoryMetadata[];
}

export default function TrajectorySelector({
  onTrajectorySelect,
  selectedTrajectoryId,
}: TrajectorySelectorProps) {
  const [trajectories, setTrajectories] = useState<TrajectoryMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingTrajectoryId, setLoadingTrajectoryId] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [defaultCollapsed, setDefaultCollapsed] = useState(true);
  const [thumbnailUrls, setThumbnailUrls] = useState<Map<string, string>>(new Map());
  const [loadedCategories, setLoadedCategories] = useState<Set<string>>(new Set());

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

  if (loading) {
    return (
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-4 text-gray-200">Trajectories</h3>
        <div className="text-gray-400 text-sm">Loading trajectories...</div>
      </div>
    );
  }

  if (error && trajectories.length === 0) {
    return (
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-4 text-gray-200">Trajectories</h3>
        <div className="text-red-400 text-sm">{error}</div>
        <button
          type="button"
          onClick={loadTrajectories}
          className="mt-2 text-blue-400 hover:text-blue-300 text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  const categoryGroups = groupTrajectories();

  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold mb-4 text-gray-200">Trajectories</h3>

      {error && (
        <div className="mb-3 text-red-400 text-xs bg-red-900 bg-opacity-20 p-2 rounded">
          {error}
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
  );
}
