'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import MuJoCoViewer, { ViewerOptions, TrajectoryPlaybackState, MuJoCoViewerRef } from '@/components/MuJoCoViewer';
import ModelSelector from '@/components/ModelSelector';
import TrajectorySelector from '@/components/TrajectorySelector';
import TrajectoryUpload from '@/components/TrajectoryUpload';
import ViewerOptionsPanel from '@/components/ViewerOptions';
import VideoControls, { MuJoCoCamera } from '@/components/VideoControls';
import { ModelMetadata, TrajectoryMetadata } from '@/lib/api';
import { parseTrajectory, TrajectoryData } from '@/lib/trajectory-parser';
import TrajectoryList from '@/components/TrajectoryList';

interface LoadedTrajectory {
  id: string;
  name: string;
  data: TrajectoryData;
  isGhost: boolean;
  source: 'server' | 'local';
}

export default function VisualizePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [selectedModelXML, setSelectedModelXML] = useState<string | undefined>();
  const [selectedModel, setSelectedModel] = useState<ModelMetadata | null>(null);
  const [loadedTrajectories, setLoadedTrajectories] = useState<LoadedTrajectory[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const lastFrameTimeRef = useRef<number>(0);
  const [viewerOptions, setViewerOptions] = useState<ViewerOptions>({
    showFixedAxes: true,
    showMovingAxes: true,
  });

  // Camera and video recording state
  const [cameras, setCameras] = useState<MuJoCoCamera[]>([]);
  const [activeCamera, setActiveCamera] = useState('free');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const viewerRef = useRef<MuJoCoViewerRef>(null);

  // Playback loop - advance frames when playing
  // Use the longest trajectory to determine max frames
  const maxFrameCount = loadedTrajectories.reduce((max, traj) =>
    Math.max(max, traj.data.frameCount), 0);
  const primaryFrameRate = loadedTrajectories[0]?.data.frameRate || 30;

  useEffect(() => {
    if (!playing || loadedTrajectories.length === 0) {
      return;
    }

    console.log('Starting playback:', {
      trajectories: loadedTrajectories.length,
      maxFrameCount,
      frameRate: primaryFrameRate,
      playbackSpeed
    });

    let animationFrameId: number;
    lastFrameTimeRef.current = performance.now();

    const advanceFrame = (currentTime: number) => {
      const deltaTime = (currentTime - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = currentTime;

      const frameDelta = deltaTime * primaryFrameRate * playbackSpeed;

      setCurrentFrame((prevFrame) => {
        const nextFrame = prevFrame + frameDelta;

        if (nextFrame >= maxFrameCount - 1) {
          console.log('Playback finished');
          setPlaying(false);
          return maxFrameCount - 1;
        }

        return nextFrame;
      });

      animationFrameId = requestAnimationFrame(advanceFrame);
    };

    animationFrameId = requestAnimationFrame(advanceFrame);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [playing, playbackSpeed, loadedTrajectories, maxFrameCount, primaryFrameRate]);

  const handleModelSelect = (modelXML: string, model: ModelMetadata) => {
    setSelectedModelXML(modelXML);
    setSelectedModel(model);
  };

  // Add trajectory from server selector
  const handleTrajectorySelect = async (trajectoryBlob: Blob, trajectory: TrajectoryMetadata) => {
    console.log('[VISUALIZE PAGE] handleTrajectorySelect called with:', trajectory.filename);

    try {
      const parsedData = await parseTrajectory(trajectoryBlob, trajectory.filename);

      const newTrajectory: LoadedTrajectory = {
        id: `server-${trajectory.id}-${Date.now()}`,
        name: trajectory.filename,
        data: parsedData,
        isGhost: false,
        source: 'server'
      };

      setLoadedTrajectories(prev => [...prev, newTrajectory]);
      console.log('[VISUALIZE PAGE] Server trajectory loaded:', newTrajectory.name);
    } catch (error) {
      console.error('[VISUALIZE PAGE] Failed to parse trajectory:', error);
      alert('Failed to load trajectory: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  // Add trajectory from local file upload
  const handleLocalTrajectoryUpload = async (file: File) => {
    console.log('[VISUALIZE PAGE] handleLocalTrajectoryUpload called with:', file.name);

    try {
      const blob = new Blob([await file.arrayBuffer()], { type: file.type });
      const parsedData = await parseTrajectory(blob, file.name);

      const newTrajectory: LoadedTrajectory = {
        id: `local-${Date.now()}`,
        name: file.name,
        data: parsedData,
        isGhost: false,
        source: 'local'
      };

      setLoadedTrajectories(prev => [...prev, newTrajectory]);
      console.log('[VISUALIZE PAGE] Local trajectory loaded:', newTrajectory.name);
    } catch (error) {
      console.error('[VISUALIZE PAGE] Failed to load local trajectory:', error);
      alert(`Failed to load trajectory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Toggle ghost mode for a trajectory
  const handleToggleGhost = (id: string) => {
    setLoadedTrajectories(prev =>
      prev.map(traj =>
        traj.id === id ? { ...traj, isGhost: !traj.isGhost } : traj
      )
    );
  };

  // Remove a trajectory
  const handleRemoveTrajectory = (id: string) => {
    setLoadedTrajectories(prev => prev.filter(traj => traj.id !== id));
  };

  const handlePlayPause = () => {
    setPlaying(!playing);
  };

  const handleReset = () => {
    setCurrentFrame(0);
    setPlaying(false);
  };

  const handleFrameChange = (frame: number) => {
    setCurrentFrame(frame);
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
  };

  const handleCameraChange = (cameraName: string) => {
    if (!isRecording) {
      setActiveCamera(cameraName);
    }
  };

  const handleRecord = async () => {
    if (viewerRef.current) {
      try {
        setIsRecording(true);
        setRecordingProgress(0);

        // Pass progress callback to update UI
        await viewerRef.current.recordVideo((progress: number) => {
          setRecordingProgress(progress);
        });

        // Ensure 100% at end
        setRecordingProgress(100);
      } catch (error) {
        console.error('Recording failed:', error);
        alert('Failed to record video: ' + (error instanceof Error ? error.message : 'Unknown error'));
      } finally {
        setIsRecording(false);
        setRecordingProgress(0);
      }
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      switch (e.key) {
        case ' ': // Space - Play/Pause
          e.preventDefault();
          handlePlayPause();
          break;
        case 'r':
        case 'R': // R - Reset
          e.preventDefault();
          handleReset();
          break;
        case 'ArrowLeft': // Left - Step back 1 second
          e.preventDefault();
          if (loadedTrajectories.length > 0) {
            const newFrame = Math.max(0, currentFrame - primaryFrameRate);
            handleFrameChange(newFrame);
          }
          break;
        case 'ArrowRight': // Right - Step forward 1 second
          e.preventDefault();
          if (loadedTrajectories.length > 0) {
            const newFrame = Math.min(maxFrameCount - 1, currentFrame + primaryFrameRate);
            handleFrameChange(newFrame);
          }
          break;
        case 'ArrowUp': // Up - Step forward 1 frame
          e.preventDefault();
          if (loadedTrajectories.length > 0) {
            const newFrame = Math.min(maxFrameCount - 1, Math.floor(currentFrame) + 1);
            handleFrameChange(newFrame);
          }
          break;
        case 'ArrowDown': // Down - Step back 1 frame
          e.preventDefault();
          if (loadedTrajectories.length > 0) {
            const newFrame = Math.max(0, Math.floor(currentFrame) - 1);
            handleFrameChange(newFrame);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playing, currentFrame, loadedTrajectories.length, maxFrameCount, primaryFrameRate]);


  // Redirect to login if not authenticated (after all hooks)
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [isLoading, isAuthenticated, router]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect via useEffect)
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-gray-800 shadow flex-shrink-0">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-white">Motion Library Visualization</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-400 flex items-center gap-4">
              {selectedModel && (
                <div>
                  {selectedModel.model_name && (
                    <span className="mr-2">{selectedModel.model_name}</span>
                  )}
                  <span>{selectedModel.filename}</span>
                </div>
              )}
              {loadedTrajectories.length > 0 && (
                <div className="text-gray-500">
                  {loadedTrajectories.length} trajectories • {maxFrameCount} frames @ {primaryFrameRate} fps
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors text-sm font-medium"
            >
              Dashboard
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar */}
        <div className="w-80 bg-gray-800 border-r border-gray-700 overflow-y-auto flex-shrink-0">
          {/* Playback Controls - Always visible */}
          <div className="border-b border-gray-700 bg-gray-750">
            <div className="p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Playback Controls</h3>

              {/* Timeline Slider */}
              <div className="mb-4">
                <label htmlFor="timeline-slider" className="block text-xs font-medium text-gray-300 mb-2">Timeline</label>
                <input
                  id="timeline-slider"
                  type="range"
                  min="0"
                  max={maxFrameCount > 0 ? maxFrameCount - 1 : 0}
                  value={maxFrameCount > 0 ? Math.floor(currentFrame) : 0}
                  onChange={(e) => handleFrameChange(parseInt(e.target.value))}
                  disabled={loadedTrajectories.length === 0}
                  aria-label="Timeline scrubber"
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>{maxFrameCount > 0 ? (currentFrame / primaryFrameRate).toFixed(2) : '0.00'}s</span>
                  <span>Frame {maxFrameCount > 0 ? Math.floor(currentFrame) + 1 : 0} / {maxFrameCount}</span>
                  <span>{maxFrameCount > 0 ? (maxFrameCount / primaryFrameRate).toFixed(2) : '0.00'}s</span>
                </div>
              </div>

              {/* Control Buttons */}
              <div className="flex flex-col gap-2 mb-4">
                <button
                  type="button"
                  onClick={handlePlayPause}
                  disabled={loadedTrajectories.length === 0}
                  className="w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-600"
                >
                  {playing ? 'Pause' : 'Play'}
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={loadedTrajectories.length === 0}
                    className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => maxFrameCount > 0 && handleFrameChange(Math.min(currentFrame + 1, maxFrameCount - 1))}
                    disabled={loadedTrajectories.length === 0}
                    className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Step →
                  </button>
                </div>
              </div>

              {/* Speed Control */}
              <div className="mb-4">
                <label htmlFor="playback-speed" className="block text-xs font-medium text-gray-300 mb-2">
                  Playback Speed
                </label>
                <select
                  id="playback-speed"
                  value={playbackSpeed}
                  onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                  disabled={loadedTrajectories.length === 0}
                  aria-label="Playback speed"
                  className="w-full px-3 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value={0.25}>0.25x</option>
                  <option value={0.5}>0.5x</option>
                  <option value={1}>1x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2}>2x</option>
                </select>
              </div>

              {/* Keyboard Shortcuts Guide */}
              <div className="mt-4 pt-4 border-t border-gray-700">
                <h4 className="text-xs font-semibold text-gray-300 mb-2">Keyboard Shortcuts</h4>
                <div className="space-y-1 text-xs text-gray-400">
                  <div className="flex justify-between">
                    <span>Play/Pause</span>
                    <span className="font-mono bg-gray-700 px-2 py-0.5 rounded">Space</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Reset</span>
                    <span className="font-mono bg-gray-700 px-2 py-0.5 rounded">R</span>
                  </div>
                  <div className="flex justify-between">
                    <span>±1 second</span>
                    <span className="font-mono bg-gray-700 px-2 py-0.5 rounded">← →</span>
                  </div>
                  <div className="flex justify-between">
                    <span>±1 frame</span>
                    <span className="font-mono bg-gray-700 px-2 py-0.5 rounded">↑ ↓</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Video Controls Section */}
          <div className="border-b border-gray-700 p-4">
            <VideoControls
              cameras={cameras}
              activeCamera={activeCamera}
              onCameraChange={handleCameraChange}
              onRecord={handleRecord}
              isRecording={isRecording}
              recordingProgress={recordingProgress}
              disabled={loadedTrajectories.length === 0}
            />
          </div>

          {/* Models Section */}
          <div className="border-b border-gray-700">
            <ModelSelector
              onModelSelect={handleModelSelect}
              selectedModelId={selectedModel?.id}
            />
          </div>

          {/* Trajectory Loading Section */}
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-sm font-medium text-gray-300 mb-3">Add Trajectory</h3>

            {/* Server trajectories */}
            <div className="mb-3">
              <TrajectorySelector
                onTrajectorySelect={handleTrajectorySelect}
                selectedTrajectoryId={undefined}
              />
            </div>

            {/* Local upload */}
            <TrajectoryUpload
              onFileSelect={handleLocalTrajectoryUpload}
              disabled={!selectedModel}
            />
          </div>

          {/* Loaded Trajectories List */}
          <div className="p-4 border-b border-gray-700">
            <TrajectoryList
              trajectories={loadedTrajectories}
              onToggleGhost={handleToggleGhost}
              onRemove={handleRemoveTrajectory}
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
            ref={viewerRef}
            modelXML={selectedModelXML}
            modelId={selectedModel?.id}
            modelMetadata={selectedModel ?? undefined}
            trajectories={loadedTrajectories}
            currentFrame={Math.floor(currentFrame)}
            options={viewerOptions}
            onModelLoaded={() => console.log('Model loaded successfully')}
            onError={(error) => console.error('Viewer error:', error)}
            onCamerasLoaded={setCameras}
            activeCamera={activeCamera}
          />
        </div>
      </div>
    </div>
  );
}
