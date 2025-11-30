'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import MuJoCoViewer, { ViewerOptions } from '@/components/MuJoCoViewer';
import ModelSelector from '@/components/ModelSelector';
import TrajectorySelector from '@/components/TrajectorySelector';
import ViewerOptionsPanel from '@/components/ViewerOptions';
import { ModelMetadata, TrajectoryMetadata } from '@/lib/api';

export default function VisualizePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [selectedModelXML, setSelectedModelXML] = useState<string | undefined>();
  const [selectedModel, setSelectedModel] = useState<ModelMetadata | null>(null);
  const [selectedTrajectory, setSelectedTrajectory] = useState<TrajectoryMetadata | null>(null);
  const [viewerOptions, setViewerOptions] = useState<ViewerOptions>({
    showFixedAxes: true,
    showMovingAxes: true,
  });

  // Redirect to login if not authenticated
  if (!isLoading && !isAuthenticated) {
    router.push('/');
    return null;
  }

  const handleModelSelect = (modelXML: string, model: ModelMetadata) => {
    setSelectedModelXML(modelXML);
    setSelectedModel(model);
  };

  const handleTrajectorySelect = (trajectoryData: Blob, trajectory: TrajectoryMetadata) => {
    setSelectedTrajectory(trajectory);
    // TODO: Parse NPY/NPZ data and apply to viewer
    console.log('Trajectory selected:', trajectory.filename);
    console.log('Trajectory data size:', trajectoryData.size);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-gray-800 shadow flex-shrink-0">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-gray-300 hover:text-white"
            >
              ← Back
            </button>
            <h1 className="text-xl font-bold text-white">Motion Library Visualization</h1>
          </div>
          {selectedModel && (
            <div className="text-sm text-gray-400">
              {selectedModel.model_name && (
                <span className="mr-2">{selectedModel.model_name}</span>
              )}
              <span>{selectedModel.filename}</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar */}
        <div className="w-80 bg-gray-800 border-r border-gray-700 overflow-y-auto flex-shrink-0">
          {/* Models Section */}
          <div className="border-b border-gray-700">
            <ModelSelector
              onModelSelect={handleModelSelect}
              selectedModelId={selectedModel?.id}
            />
          </div>

          {/* Trajectories Section */}
          <div className="border-b border-gray-700">
            <TrajectorySelector
              onTrajectorySelect={handleTrajectorySelect}
              selectedTrajectoryId={selectedTrajectory?.id}
            />
          </div>

          {/* Viewer Options Section */}
          <div className="border-b border-gray-700">
            <ViewerOptionsPanel
              options={viewerOptions}
              onChange={setViewerOptions}
            />
          </div>
        </div>

        {/* 3D Viewer */}
        <div className="flex-1 relative">
          <MuJoCoViewer
            modelXML={selectedModelXML}
            modelId={selectedModel?.id}
            modelMetadata={selectedModel ?? undefined}
            options={viewerOptions}
            onModelLoaded={() => console.log('Model loaded successfully')}
            onError={(error) => console.error('Viewer error:', error)}
          />
        </div>
      </div>
    </div>
  );
}
