'use client';

import { useState, useEffect } from 'react';
import { modelApi, ModelMetadata, API_BASE_URL } from '@/lib/api';

interface ModelSelectorProps {
  onModelSelect: (modelXML: string, model: ModelMetadata) => void;
  selectedModelId?: string;
}

interface FolderGroup {
  folderName: string;
  models: ModelMetadata[];
}

export default function ModelSelector({ onModelSelect, selectedModelId }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [defaultCollapsed, setDefaultCollapsed] = useState(true);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await modelApi.list();
      setModels(response.models);

      // Initialize all folders as collapsed if defaultCollapsed is true
      if (defaultCollapsed) {
        const folderNames = new Set<string>();
        response.models.forEach((model) => {
          const pathParts = model.relative_path.split('/');
          const folderName = pathParts.length > 1 ? pathParts[0] : 'Root';
          folderNames.add(folderName);
        });
        setCollapsedFolders(folderNames);
        setDefaultCollapsed(false); // Only do this once
      }
    } catch (err) {
      setError('Failed to load models');
      console.error('Error loading models:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleModelClick = async (model: ModelMetadata) => {
    try {
      setLoadingModelId(model.id);
      setError(null);

      // Fetch the model XML file
      const blob = await modelApi.get(model.id);
      const xmlContent = await blob.text();

      onModelSelect(xmlContent, model);
    } catch (err) {
      setError('Failed to load model file');
      console.error('Error loading model file:', err);
    } finally {
      setLoadingModelId(null);
    }
  };

  const toggleFolder = (folderName: string) => {
    setCollapsedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(folderName)) {
        newSet.delete(folderName);
      } else {
        newSet.add(folderName);
      }
      return newSet;
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Group models by folder
  const groupModelsByFolder = (): FolderGroup[] => {
    const folderMap = new Map<string, ModelMetadata[]>();

    models.forEach((model) => {
      // Extract folder name from relative_path
      // e.g., "MS-Human-700/model.xml" -> "MS-Human-700"
      const pathParts = model.relative_path.split('/');
      const folderName = pathParts.length > 1 ? pathParts[0] : 'Root';

      if (!folderMap.has(folderName)) {
        folderMap.set(folderName, []);
      }
      folderMap.get(folderName)!.push(model);
    });

    // Convert to array and sort by folder name
    return Array.from(folderMap.entries())
      .map(([folderName, models]) => ({ folderName, models }))
      .sort((a, b) => a.folderName.localeCompare(b.folderName));
  };

  if (loading) {
    return (
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-4 text-gray-200">Models</h3>
        <div className="text-gray-400 text-sm">Loading models...</div>
      </div>
    );
  }

  if (error && models.length === 0) {
    return (
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-4 text-gray-200">Models</h3>
        <div className="text-red-400 text-sm">{error}</div>
        <button
          type="button"
          onClick={loadModels}
          className="mt-2 text-blue-400 hover:text-blue-300 text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  const folderGroups = groupModelsByFolder();

  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold mb-4 text-gray-200">Models</h3>

      {error && (
        <div className="mb-3 text-red-400 text-xs bg-red-900 bg-opacity-20 p-2 rounded">
          {error}
        </div>
      )}

      {models.length === 0 ? (
        <div className="text-gray-400 text-sm">No models available</div>
      ) : (
        <div className="space-y-3">
          {folderGroups.map((group) => {
            const isCollapsed = collapsedFolders.has(group.folderName);

            return (
              <div key={group.folderName} className="space-y-2">
                {/* Folder Header */}
                <button
                  type="button"
                  onClick={() => toggleFolder(group.folderName)}
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
                    {group.folderName}
                  </span>
                  <span className="text-xs text-gray-400">
                    ({group.models.length})
                  </span>
                </button>

                {/* Models in folder */}
                {!isCollapsed && (
                  <div className="space-y-2">
                    {group.models.map((model) => {
                      const isSelected = model.id === selectedModelId;
                      const isLoading = model.id === loadingModelId;

                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => handleModelClick(model)}
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
                          <div className="flex gap-3">
                            {/* Thumbnail column */}
                            <div className="flex-shrink-0 w-20 h-20 bg-gray-600 rounded overflow-hidden">
                              {model.thumbnail_path ? (
                                <img
                                  src={`${API_BASE_URL}/api/models/${model.id}/thumbnail`}
                                  alt={model.filename}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                  No preview
                                </div>
                              )}
                            </div>

                            {/* Info column */}
                            <div className="flex-1 flex flex-col gap-1 min-w-0">
                              {model.model_name && (
                                <div className="text-xs text-gray-400 font-medium truncate">
                                  {model.model_name}
                                </div>
                              )}
                              <div className="text-sm text-gray-200 font-medium truncate">
                                {model.filename}
                              </div>
                              <div className="text-xs text-gray-400">
                                {formatFileSize(model.file_size)}
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
