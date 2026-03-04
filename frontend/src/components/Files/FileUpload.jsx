import React, { useState, useCallback } from 'react';
import { Upload } from 'lucide-react';
import { filesService } from '../../services/files';
import toast from 'react-hot-toast';

export default function FileUpload({ onSuccess }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      await filesService.uploadFile(file);
      toast.success('Fichier uploadé avec succès !');
      onSuccess?.();
    } catch (err) {
      toast.error('Erreur upload : ' + (err?.response?.data?.detail || err.message));
    } finally {
      setUploading(false);
    }
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, []);

  return (
    <div className="bg-white rounded-2xl p-8 border border-gray-200">
      <h2 className="text-xl font-bold text-green-800 mb-6">Upload de fichier</h2>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById('fileInput').click()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all
          ${dragging ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-green-400 hover:bg-gray-50'}`}
      >
        <Upload size={40} className="mx-auto mb-4 text-green-500" />
        <p className="text-gray-600 font-medium">Glissez un fichier ici ou cliquez</p>
        <p className="text-gray-400 text-sm mt-1">CSV, Excel, JSON</p>
        <input
          id="fileInput"
          type="file"
          className="hidden"
          accept=".csv,.xlsx,.xls,.json"
          onChange={(e) => handleFile(e.target.files[0])}
        />
      </div>
      {uploading && (
        <div className="mt-4 flex items-center justify-center gap-3 text-green-600">
          <div className="w-5 h-5 border-2 border-green-200 border-t-green-600 rounded-full animate-spin" />
          <span className="text-sm font-medium">Upload en cours...</span>
        </div>
      )}
    </div>
  );
}