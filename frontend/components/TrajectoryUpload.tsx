'use client';

import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

interface TrajectoryUploadProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

export default function TrajectoryUpload({ onFileSelect, disabled = false }: TrajectoryUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (file.name.endsWith('.npy') || file.name.endsWith('.npz'))) {
      onFileSelect(file);
    } else if (file) {
      alert('Please select a .npy or .npz file');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
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

    if (disabled) return;

    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.npy') || file.name.endsWith('.npz'))) {
      onFileSelect(file);
    } else if (file) {
      alert('Please drop a .npy or .npz file');
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-300">Local Trajectory</h3>

      {/* Drag-and-drop area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-4 text-center cursor-pointer
          transition-colors
          ${isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 hover:border-gray-500'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
        <p className="text-sm text-gray-400">
          Drop .npy/.npz file or click to browse
        </p>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".npy,.npz"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled}
      />
    </div>
  );
}
