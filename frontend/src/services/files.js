import api from './api';

export const filesService = {

  uploadFile: async (file, onProgress) => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded * 100) / e.total));
        }
      },
    });
    return res.data;
  },

  parseFile: async (id) => {
    const res = await api.post(`/files/${id}/parse`, {}, { timeout: 120000 });
    return res.data;
  },

  uploadAndParse: async (file, onProgress, onStatus) => {
    onStatus?.('uploading', 'Upload en cours...');

    const formData = new FormData();
    formData.append('file', file);

    let uploadData;
    try {
      const res = await api.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
        onUploadProgress: (e) => {
          if (e.total) onProgress?.(Math.min(Math.round((e.loaded * 100) / e.total), 90));
        },
      });
      uploadData = res.data;

    } catch (err) {
      const detail = err?.response?.data?.detail || '';
      const status = err?.response?.status;

      // ✅ Cas "File already uploaded" → on récupère le fichier existant et on parse
      if (
        status === 400 &&
        (detail.toLowerCase().includes('already') ||
         detail.toLowerCase().includes('existe') ||
         detail.toLowerCase().includes('exist'))
      ) {
        console.warn('⚠️ File already uploaded, fetching existing file...');
        onStatus?.('uploading', 'Fichier déjà présent, récupération...');

        // Chercher le fichier existant dans la liste
        const files = await filesService.getFiles(0, 200);
        const existing = files.find(f =>
          (f.original_filename || f.filename || '')
            .toLowerCase() === file.name.toLowerCase()
        );

        if (existing) {
          uploadData = existing;
          console.log('✅ Found existing file:', existing);
        } else {
          // Fichier existe dans le backend mais pas trouvé → on remonte l'erreur
          throw new Error(`Fichier déjà uploadé (ID non trouvé). Vérifiez la liste.`);
        }
      } else {
        throw new Error('Upload échoué : ' + detail || err.message);
      }
    }

    const fileId = uploadData?.id;
    if (!fileId) throw new Error('ID fichier non reçu : ' + JSON.stringify(uploadData));

    onProgress?.(95);

    // Parse
    onStatus?.('parsing', 'Extraction des coûts...');
    let parseData;
    try {
      const res = await api.post(`/files/${fileId}/parse`, {}, { timeout: 120000 });
      parseData = res.data;
    } catch (err) {
      console.warn('⚠️ Parse failed:', err?.response?.data);
      parseData = {
        error: err?.response?.data?.detail || err.message,
        costs_created: 0,
      };
    }

    onProgress?.(100);
    onStatus?.('done', 'Terminé !');

    return { file: uploadData, parse: parseData, fileId };
  },

  // ✅ getFiles — essaie plusieurs URLs
  getFiles: async (skip = 0, limit = 100) => {
    const urls = [
      `/files/?skip=${skip}&limit=${limit}`,
      `/files?skip=${skip}&limit=${limit}`,
    ];

    for (const url of urls) {
      try {
        console.log(`📋 Trying getFiles: ${url}`);
        const res = await api.get(url, { timeout: 15000 });
        console.log(`✅ getFiles OK (${url}):`, res.data);
        return Array.isArray(res.data) ? res.data : res.data?.items ?? res.data?.files ?? [];
      } catch (err) {
        if (err?.response?.status === 404) {
          console.warn(`⚠️ 404 on ${url}, trying next...`);
          continue;
        }
        throw err;
      }
    }
    throw new Error('Route /files introuvable');
  },

  deleteFile: async (id) => {
    const res = await api.delete(`/files/${id}`, { timeout: 10000 });
    return res.data;
  },
};