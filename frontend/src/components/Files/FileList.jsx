import React, { useEffect, useState } from 'react';
import { Trash2, Play, FileText } from 'lucide-react';
import { filesService } from '../../services/files';
import LoadingSpinner from '../Common/LoadingSpinner';
import toast from 'react-hot-toast';

export default function FileList({ refresh }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadFiles(); }, [refresh]);

  const loadFiles = async () => {
    try {
      setLoading(true);
      setFiles((await filesService.getFiles()) || []);
    } catch {
      toast.error('Erreur chargement fichiers');
    } finally {
      setLoading(false);
    }
  };

  const handleParse = async (id) => {
    try {
      await filesService.parseFile(id);
      toast.success('Fichier parsé !');
      loadFiles();
    } catch { toast.error('Erreur parsing'); }
  };

  const handleDelete = async (id) => {
    try {
      await filesService.deleteFile(id);
      toast.success('Fichier supprimé !');
      loadFiles();
    } catch { toast.error('Erreur suppression'); }
  };

  if (loading) return <LoadingSpinner message="Chargement des fichiers..." />;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {files.length === 0 ? (
        <div className="p-12 text-center">
          <FileText size={40} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-400">Aucun fichier uploadé</p>
        </div>
      ) : (
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Nom', 'Taille', 'Statut', 'Actions'].map(h => (
                <th key={h} className="px-6 py-3 text-left text-xs font-semibold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {files.map(f => (
              <tr key={f.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm font-medium text-gray-800">{f.original_filename || f.filename}</td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {f.file_size ? `${(f.file_size / 1024).toFixed(1)} KB` : '—'}
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold
                    ${f.status === 'parsed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {f.status || 'uploaded'}
                  </span>
                </td>
                <td className="px-6 py-4 flex items-center gap-2">
                  <button onClick={() => handleParse(f.id)} className="p-2 text-green-600 hover:bg-green-50 rounded-lg" title="Parser">
                    <Play size={16} />
                  </button>
                  <button onClick={() => handleDelete(f.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg" title="Supprimer">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}