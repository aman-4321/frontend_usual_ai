import { useState, useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';
import { chatApi } from '../services/chat';
import { s3Api } from '../services/s3';
import ModelSelector from './ModelSelector';

function VideoPanel({ segment, onClose }) {
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState({});
  const [error, setError] = useState(null);
  const [selectedVideoModel, setSelectedVideoModel] = useState(chatApi.getDefaultModel('VIDEO'));

  useEffect(() => {
    if (segment?.imageUrl && segment?.id && !videos[segment.id]) {
      handleGenerateVideo(segment);
    }
  }, [segment?.imageUrl, segment?.id]);

  const handleGenerateVideo = async (currentSegment) => {
    if (!currentSegment?.imageUrl || !currentSegment?.narration) {
      setError('Required data missing for video generation');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await chatApi.generateVideo({
        animation_prompt: currentSegment.animation || currentSegment.visual,
        art_style: currentSegment.artStyle || '',
        image_s3_key: currentSegment.imageUrl,
        uuid: currentSegment.id,
        model: selectedVideoModel,
      });
      
      if (result.s3_key) {
        // Download video from S3 and create blob URL
        const videoUrl = await s3Api.downloadVideo(result.s3_key);
        setVideos(prev => ({
          ...prev,
          [currentSegment.id]: videoUrl
        }));
      } else {
        throw new Error('No video URL in response');
      }
    } catch (err) {
      console.error('Error generating video:', err);
      setError(err.message || 'Failed to generate video');
    } finally {
      setLoading(false);
    }
  };

  const currentVideo = segment ? videos[segment.id] : null;

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <div className="flex justify-between items-center p-4 border-b border-gray-800">
        <h3 className="text-lg font-semibold">Video Preview</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white"
          aria-label="Close video panel"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Model Selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">Video Generation Model</label>
          <ModelSelector
            genType="VIDEO"
            selectedModel={selectedVideoModel}
            onModelChange={setSelectedVideoModel}
            disabled={loading}
            className="w-full"
          />
        </div>

        {/* Video Preview */}
        {currentVideo && !loading && (
          <div className="space-y-2">
            <video
              src={currentVideo}
              controls
              className="w-full rounded-lg bg-black"
            >
              Your browser does not support the video tag.
            </video>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="text-red-400 text-sm p-2 bg-red-900/20 rounded-lg">
            {error}
            <button
              onClick={() => segment && handleGenerateVideo(segment)}
              className="ml-2 text-blue-400 hover:text-blue-300"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-8">
            <LoadingSpinner />
          </div>
        )}
      </div>
    </div>
  );
}

export default VideoPanel; 