'use client';

import React from 'react';

interface LoadedTrajectory {
  id: string;
  name: string;
  data: any;
  isGhost: boolean;
  source: 'server' | 'local';
}

interface TrajectoryListProps {
  trajectories: LoadedTrajectory[];
  onToggleGhost: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function TrajectoryList({ trajectories, onToggleGhost, onRemove }: TrajectoryListProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-300 mb-2">
        Loaded Trajectories ({trajectories.length})
      </h3>

      {trajectories.length === 0 && (
        <p className="text-sm text-gray-500">No trajectories loaded</p>
      )}

      {trajectories.map(traj => (
        <div key={traj.id} className="flex items-center gap-2 p-2 bg-gray-800 rounded">
          {/* Ghost checkbox */}
          <input
            type="checkbox"
            checked={traj.isGhost}
            onChange={() => onToggleGhost(traj.id)}
            className="w-4 h-4"
            title="Render as ghost (semi-transparent)"
          />

          {/* Trajectory name */}
          <span className="flex-1 text-sm text-gray-300 truncate" title={traj.name}>
            {traj.name}
          </span>

          {/* Source badge */}
          <span className={`text-xs px-2 py-1 rounded ${
            traj.source === 'server' ? 'bg-blue-600' : 'bg-green-600'
          }`}>
            {traj.source}
          </span>

          {/* Remove button */}
          <button
            onClick={() => onRemove(traj.id)}
            className="text-red-400 hover:text-red-300"
            title="Remove trajectory"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
