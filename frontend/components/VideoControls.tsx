'use client';

import React, { useState } from 'react';
import { Video } from 'lucide-react';

export interface MuJoCoCamera {
  name: string;
  mujocoId: number; // -1 for "free" camera, >= 0 for MuJoCo cameras
}

interface VideoControlsProps {
  cameras: MuJoCoCamera[];
  activeCamera: string;
  onCameraChange: (cameraName: string) => void;
  onRecord: () => void;
  isRecording: boolean;
  recordingProgress: number;
  disabled?: boolean;
}

export default function VideoControls({
  cameras,
  activeCamera,
  onCameraChange,
  onRecord,
  isRecording,
  recordingProgress,
  disabled = false
}: VideoControlsProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="p-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <h2 className="text-lg font-semibold text-white">Video & Camera</h2>
        <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div className="space-y-4">
          {/* Camera Selection */}
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">Camera View</h3>
            <div className="flex flex-wrap gap-2">
              {cameras.map((cam) => (
                <button
                  key={cam.name}
                  onClick={() => onCameraChange(cam.name)}
                  disabled={isRecording}
                  className={`px-3 py-1.5 text-sm rounded transition-colors ${
                    activeCamera === cam.name
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                  title={cam.mujocoId >= 0 ? `MuJoCo Camera: ${cam.name}` : 'Free Camera (OrbitControls)'}
                >
                  {cam.name}
                </button>
              ))}
            </div>
          </div>

          {/* Recording Controls */}
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">Recording</h3>
            <button
              onClick={onRecord}
              disabled={isRecording || disabled}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full justify-center"
              title={disabled ? 'Load a trajectory to enable recording' : 'Record video at 1920x1080 @ 30fps'}
            >
              <Video className="w-5 h-5" />
              {isRecording ? 'Recording...' : 'Record Video'}
            </button>

            {isRecording && (
              <div className="mt-3">
                <div className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-red-600 h-2.5 rounded-full transition-[width] duration-100 ease-linear"
                    style={{ width: `${recordingProgress}%` }}
                  />
                </div>
                <p className="text-sm text-gray-400 mt-1.5 text-center">
                  {Math.round(recordingProgress)}% complete
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
