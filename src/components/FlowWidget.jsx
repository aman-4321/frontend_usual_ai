import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "../hooks/useAuth";
import ChatLoginButton from "./ChatLoginButton";
import LoginLogoutButton from "./LoginLogoutButton";
import LoadingSpinner from "./LoadingSpinner";
import { projectApi } from "../services/project";
import { chatApi } from "../services/chat";

import ModelSelector from "./ModelSelector";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import SegmentNode from "./FlowWidget/SegmentNode";
import ImageNode from "./FlowWidget/ImageNode";
import VideoNode from "./FlowWidget/VideoNode";
import AddImageNode from "./FlowWidget/AddImageNode";
import AddVideoNode from "./FlowWidget/AddVideoNode";

function FlowWidget() {
  const { isAuthenticated, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // We only track messages via setter; value itself not needed for UI rendering
  const [, setFlowMessages] = useState([]); // track assistant messages
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [projectData, setProjectData] = useState(null);
  const [regeneratingImages, setRegeneratingImages] = useState(new Set());
  const [regeneratingVideos, setRegeneratingVideos] = useState(new Set());
  const [creatingImages, setCreatingImages] = useState(new Set());
  const [creatingVideos, setCreatingVideos] = useState(new Set());
  const [temporaryVideos, setTemporaryVideos] = useState(new Map()); // Store temporary videos: key = `${segmentId}-${imageId}`, value = videoUrl
  // Model selection states
  const [selectedImageModel, setSelectedImageModel] = useState(chatApi.getDefaultModel('IMAGE'));
  const [selectedVideoModel, setSelectedVideoModel] = useState(chatApi.getDefaultModel('VIDEO'));

  // New state for all fetched data
  const [allProjectData, setAllProjectData] = useState({
    segments: [],
    images: [],
    videos: []
  });

  // Helper function to refresh project data
  const refreshProjectData = useCallback(async () => {
    if (!isAuthenticated) {
      console.log("User not authenticated, skipping API calls");
      return;
    }

    // Get project ID from localStorage
    let projectId;
    try {
      const storedProject = localStorage.getItem('project-store-selectedProject');
      if (storedProject) {
        const project = JSON.parse(storedProject);
        projectId = project.id;
      }
    } catch (error) {
      console.error("Error parsing project from localStorage:", error);
    }

    if (!projectId) {
      console.log("No project ID found in localStorage");
      setError("No project selected. Please select a project first.");
      return;
    }

    console.log("Fetching project segmentations and related images/videos for project ID:", projectId);
    try {
      setLoading(true);
      
      // Fetch project segmentations, images, and videos in parallel
      const [
        segmentationsData,
        imagesData,
        videosData
      ] = await Promise.all([
        projectApi.getProjectSegmentations(projectId),
        projectApi.getProjectImages(projectId),
        projectApi.getProjectVideos(projectId)
      ]);

      console.log("Project data fetched successfully:");
      console.log("Segmentations:", segmentationsData);
      console.log("Images:", imagesData);
      console.log("Videos:", videosData);

      // Extract segments from the first segmentation
      let segments = [];
      if (segmentationsData && segmentationsData.success && segmentationsData.data && segmentationsData.data.length > 0) {
        const firstSegmentation = segmentationsData.data[0];
        if (firstSegmentation.segments && Array.isArray(firstSegmentation.segments)) {
          segments = firstSegmentation.segments;
        }
      }

      setAllProjectData({
        segments: segments,
        images: imagesData?.data || [],
        videos: videosData?.data || []
      });

      // Keep the old projectData for backward compatibility
      setProjectData({ success: true, project: { segments: segments } });
      
    } catch (error) {
      console.error("Failed to fetch project data:", error);
      setError("Failed to fetch project data");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);





  // Load data from API (no localStorage fallback)
  const flowData = useMemo(() => {
    console.log("🔄 flowData useMemo called, allProjectData:", allProjectData);
    
    // 1. Get segments from segmentation API response
    const segments = allProjectData.segments.map(seg => ({
      ...seg,
      id: seg.segmentId || seg.id, // Use segmentId for mapping
      visual: seg.visual || '',
      narration: seg.narration || '',
      animation: seg.animation || ''
    }));
    console.log("📋 Processed segments:", segments);

    // 2. Build images/videos lookup by segmentId and store image details
    const images = {};
    const imageDetails = {};
    const allImagesBySegment = {};
    
    if (Array.isArray(allProjectData.images)) {
      allProjectData.images.forEach(img => {
        if (img && img.success && img.s3Key && img.uuid) {
          // Extract segmentId from uuid (handles both 'seg-2' and 'seg-2-1234567890' formats)
          const segmentId = img.uuid.replace(/^seg-(\d+)(?:-\d+)?$/, '$1');
          
          // Initialize arrays if they don't exist
          if (!allImagesBySegment[segmentId]) {
            allImagesBySegment[segmentId] = [];
          }
          
          // Add this image to the segment's image list
          allImagesBySegment[segmentId].push({
            id: img.id,
            url: `https://ds0fghatf06yb.cloudfront.net/${img.s3Key}`,
            visualPrompt: img.visualPrompt,
            artStyle: img.artStyle,
            s3Key: img.s3Key,
            uuid: img.uuid,
            isPrimary: typeof img.isPrimary === 'boolean' ? img.isPrimary : !img.uuid.includes('-') // Prefer backend flag, fallback to UUID heuristic
          });
        }
      });
      
      // For backward compatibility, keep the first image as the main one
      Object.keys(allImagesBySegment).forEach(segmentId => {
        const segmentImages = allImagesBySegment[segmentId];
        if (segmentImages.length > 0) {
          // Sort by primary first, then by creation time (uuid timestamp)
          segmentImages.sort((a, b) => {
            if (a.isPrimary && !b.isPrimary) return -1;
            if (!a.isPrimary && b.isPrimary) return 1;
            return 0;
          });
          
          const primaryImage = segmentImages[0];
          images[segmentId] = primaryImage.url;
          imageDetails[segmentId] = {
            id: primaryImage.id,
            visualPrompt: primaryImage.visualPrompt,
            artStyle: primaryImage.artStyle,
            s3Key: primaryImage.s3Key,
            allImages: segmentImages // Store all images for the segment
          };
        }
      });
    }
    const videos = {};
    const videoDetails = {};
    if (Array.isArray(allProjectData.videos)) {
      allProjectData.videos.forEach(video => {
        if (
          video && video.success && video.uuid &&
          Array.isArray(video.videoFiles) && video.videoFiles.length > 0 && video.videoFiles[0].s3Key
        ) {
          const segmentId = video.uuid.replace(/^seg-/, '');
          videos[segmentId] = `https://ds0fghatf06yb.cloudfront.net/${video.videoFiles[0].s3Key}`;
          videoDetails[segmentId] = {
            id: video.id,
            artStyle: video.artStyle,
            imageS3Key: video.imageS3Key || null,
          };
        }
      });
    }
    console.log("🖼️ Images map:", images);
    console.log("📝 Image details:", imageDetails);
    console.log("🎬 Videos map:", videos);
    
    // Add temporary videos to the videos map
    temporaryVideos.forEach((videoUrl, key) => {
      videos[key] = videoUrl;
    });
    
    console.log("🎬 Videos map (including temporary):", videos);
    return { segments, images, videos, imageDetails, videoDetails };
  }, [allProjectData, temporaryVideos]);

  // Handle image regeneration
  const handleRegenerateImage = useCallback(async (imageId, segmentData) => {
    if (!isAuthenticated || regeneratingImages.has(imageId)) return;

    // Get project ID from localStorage
    let projectId;
    try {
      const storedProject = localStorage.getItem('project-store-selectedProject');
      if (storedProject) {
        const project = JSON.parse(storedProject);
        projectId = project.id;
      }
    } catch (error) {
      console.error("Error parsing project from localStorage:", error);
    }

    if (!projectId) {
      setError("No project selected. Please select a project first.");
      return;
    }

    console.log("🔄 Regenerating image:", imageId, segmentData);
    setRegeneratingImages(prev => new Set(prev).add(imageId));
    try {
      let genResponse;
      
      // Check if we already have a new s3_key from the ImageNode edit
      if (segmentData.s3Key) {
        console.log("✅ Using existing s3_key from ImageNode edit:", segmentData.s3Key);
        genResponse = { s3_key: segmentData.s3Key };
      } else {
        // Generate new image
        genResponse = await chatApi.generateImage({
          visual_prompt: segmentData.visual,
          art_style: segmentData.artStyle || 'cinematic photography with soft lighting',
          uuid: `seg-${segmentData.id}`,
          project_id: projectId,
          model: selectedImageModel,
        });
        console.log("✅ Image generation successful:", genResponse);
      }
      
      // Update the image metadata if we have a new s3_key
      if (genResponse && genResponse.s3_key) {
        // Note: The new unified API doesn't have a separate regenerateImage endpoint
        // The image is regenerated directly through the generateImage call
        console.log("✅ Image regeneration completed with s3_key:", genResponse.s3_key);
      }
      
      // Refresh project data to get the updated image
      await refreshProjectData();
      setFlowMessages(prev => [
        ...prev,
        {
          type: "assistant",
          content: `Image for scene ${segmentData.id} regenerated successfully!`,
        },
      ]);
    } catch (error) {
      console.error("❌ Image regeneration (overwrite+patch) failed:", error);
      setError(`Failed to regenerate image: ${error.message}`);
    } finally {
      setRegeneratingImages(prev => {
        const newSet = new Set(prev);
        newSet.delete(imageId);
        return newSet;
      });
    }
  }, [isAuthenticated, regeneratingImages, refreshProjectData, selectedImageModel]);

  // Handle video regeneration
  const handleRegenerateVideo = useCallback(async (videoId, segmentData) => {
    if (!isAuthenticated || regeneratingVideos.has(videoId)) return;

    // Get project ID from localStorage
    let projectId;
    try {
      const storedProject = localStorage.getItem('project-store-selectedProject');
      if (storedProject) {
        const project = JSON.parse(storedProject);
        projectId = project.id;
      }
    } catch (error) {
      console.error("Error parsing project from localStorage:", error);
    }

    if (!projectId) {
      setError("No project selected. Please select a project first.");
      return;
    }

    setRegeneratingVideos(prev => new Set(prev).add(videoId));
    try {
      // Always use the s3_key of the connected image for imageS3Key
      const imageS3Key = flowData.imageDetails?.[segmentData.id]?.s3Key || segmentData.imageS3Key;
      
      const genResponse = await chatApi.generateVideo({
        animation_prompt: segmentData.animation,
        art_style: segmentData.artStyle,
        image_s3_key: imageS3Key,
        uuid: `seg-${segmentData.id}`,
        project_id: projectId,
        model: selectedVideoModel,
      });
      if (genResponse && genResponse.s3_key) {
        console.log("🔄 Video re-generation response:", genResponse.s3_key);
        // Note: The new unified API doesn't have a separate regenerateVideo endpoint
        // The video is regenerated directly through the generateVideo call
      }
      // 3. Refresh project data to get the updated video
      await refreshProjectData();
      setFlowMessages(prev => [
        ...prev,
        {
          type: "assistant",
          content: `Video for scene ${segmentData.id} regenerated, overwritten, and metadata updated successfully!`,
        },
      ]);
    } catch (error) {
      setError(`Failed to regenerate video: ${error.message}`);
    } finally {
      setRegeneratingVideos(prev => {
        const newSet = new Set(prev);
        newSet.delete(videoId);
        return newSet;
      });
    }
  }, [isAuthenticated, regeneratingVideos, flowData.imageDetails, refreshProjectData, selectedVideoModel]);

  // Handle creating new image for a segment
  const handleCreateNewImage = useCallback(async (segmentId, segmentData) => {
    if (!isAuthenticated) return;

    // Get project ID from localStorage
    let projectId;
    try {
      const storedProject = localStorage.getItem('project-store-selectedProject');
      if (storedProject) {
        const project = JSON.parse(storedProject);
        projectId = project.id;
      }
    } catch (error) {
      console.error("Error parsing project from localStorage:", error);
    }

    if (!projectId) {
      setError("No project selected. Please select a project first.");
      return;
    }

    console.log("🆕 Creating new image for segment:", segmentId, segmentData);
    setCreatingImages(prev => new Set(prev).add(segmentId));
    try {
      // Generate new image with unique timestamp to avoid overwriting
      const timestamp = Date.now();
      const uniqueUuid = `seg-${segmentId}-${timestamp}`;
      
      const genResponse = await chatApi.generateImage({
        visual_prompt: segmentData.visual,
        art_style: segmentData.artStyle || 'cinematic photography with soft lighting',
        uuid: uniqueUuid,
        project_id: projectId,
        model: selectedImageModel,
      });
      console.log("✅ New image generation successful:", genResponse);
      
      // Refresh project data to get the new image
      await refreshProjectData();
      setFlowMessages(prev => [
        ...prev,
        {
          type: "assistant",
          content: `New image for scene ${segmentId} created successfully!`,
        },
      ]);
    } catch (error) {
      console.error("❌ New image creation failed:", error);
      setError(`Failed to create new image: ${error.message}`);
    } finally {
      setCreatingImages(prev => {
        const newSet = new Set(prev);
        newSet.delete(segmentId);
        return newSet;
      });
    }
  }, [isAuthenticated, refreshProjectData, selectedImageModel]);

  // Handle making an image primary
  const handleMakePrimary = useCallback(async (imageId, segmentId, allImages) => {
    if (!isAuthenticated) return;

    console.log("⭐ Making image primary:", imageId, "for segment:", segmentId);
    try {
      // Find the image to make primary
      const targetImage = allImages.find(img => img.id === imageId);
      if (!targetImage) {
        console.error("Image not found:", imageId);
        return;
      }

      // Get project ID from localStorage
      let projectId;
      try {
        const storedProject = localStorage.getItem('project-store-selectedProject');
        if (storedProject) {
          const project = JSON.parse(storedProject);
          projectId = project.id;
        }
      } catch (error) {
        console.error("Error parsing project from localStorage:", error);
      }

      if (!projectId) {
        setError("No project selected. Please select a project first.");
        return;
      }

      // Update project record to mark this image as primary (no new generation)
      await projectApi.setPrimaryImage(projectId, imageId);

      // Refresh project data to get the updated image
      await refreshProjectData();
      setFlowMessages(prev => [
        ...prev,
        {
          type: "assistant",
          content: `Image for scene ${segmentId} is now primary!`,
        },
      ]);
    } catch (error) {
      console.error("❌ Failed to make image primary:", error);
      setError(`Failed to make image primary: ${error.message}`);
    }
  }, [isAuthenticated, refreshProjectData]);

  // Handle creating new video for a specific image
  const handleCreateNewVideo = useCallback(async (segmentId, imageId, segmentData) => {
    if (!isAuthenticated || creatingVideos.has(imageId)) return;

    // Get project ID from localStorage
    let projectId;
    try {
      const storedProject = localStorage.getItem('project-store-selectedProject');
      if (storedProject) {
        const project = JSON.parse(storedProject);
        projectId = project.id;
      }
    } catch (error) {
      console.error("Error parsing project from localStorage:", error);
    }

    if (!projectId) {
      setError("No project selected. Please select a project first.");
      return;
    }

    console.log("🎬 Creating new video for image:", imageId, "segment:", segmentId);
    setCreatingVideos(prev => new Set(prev).add(imageId));
    try {
      // Find the image details to get the s3_key
      const imageDetail = flowData.imageDetails[segmentId];
      const targetImage = imageDetail?.allImages?.find(img => img.id === imageId);
      
      if (!targetImage) {
        throw new Error("Image not found");
      }

      // Generate new video with unique timestamp
      const timestamp = Date.now();
      const uniqueUuid = `seg-${segmentId}-${timestamp}`;
      
      const genResponse = await chatApi.generateVideo({
        animation_prompt: segmentData.animation,
        art_style: segmentData.artStyle || 'cinematic photography with soft lighting',
        image_s3_key: targetImage.s3Key,
        uuid: uniqueUuid,
        project_id: projectId,
        model: selectedVideoModel,
      });
      
      console.log("✅ New video generation successful:", genResponse);
      
      // Store the generated video URL in temporary videos state
      if (genResponse && genResponse.s3_key) {
        const videoUrl = `https://ds0fghatf06yb.cloudfront.net/${genResponse.s3_key}`;
        const videoKey = `${segmentId}-${imageId}`;
        setTemporaryVideos(prev => new Map(prev).set(videoKey, videoUrl));
        
        setFlowMessages(prev => [
          ...prev,
          {
            type: "assistant",
            content: `New video for scene ${segmentId} generated successfully! (Preview mode - not saved to database)`,
          },
        ]);
      }
    } catch (error) {
      console.error("❌ New video creation failed:", error);
      setError(`Failed to create new video: ${error.message}`);
    } finally {
      setCreatingVideos(prev => {
        const newSet = new Set(prev);
        newSet.delete(imageId);
        return newSet;
      });
    }
  }, [isAuthenticated, flowData.imageDetails, creatingVideos, selectedVideoModel]);

  // Create nodes and edges from flow data
  const createFlowElements = useCallback(() => {
    console.log("🎯 createFlowElements called with flowData:", flowData);
    const newNodes = [];
    const newEdges = [];

    if (flowData.segments && flowData.segments.length > 0) {
      console.log("📊 Creating nodes for", flowData.segments.length, "segments");
      const nodeSpacing = 220; // horizontal space between columns
      const rowSpacing = 300; // vertical space between images
      const startX = 50;
      const startY = 50;
      const segmentSpacing = 600; // Space between segments
      
      flowData.segments.forEach((segment, segIndex) => {
        const x = startX;
        const y = startY + segIndex * segmentSpacing; // segmentSpacing = enough vertical space for all images/videos
        // Segment node
        newNodes.push({
          id: `segment-${segment.id}`,
          type: "segmentNode",
          position: { x, y },
          data: {
            ...segment,
            status: (flowData.videos[segment.id] ? "completed" : flowData.images[segment.id] ? "generating" : "pending"),
          },
        });
        // Add Image node to the right of segment
        const addImageX = x + nodeSpacing;
        newNodes.push({
          id: `add-image-${segment.id}`,
          type: "addImageNode",
          position: { x: addImageX, y },
          data: {
            segmentId: segment.id,
            segmentData: {
              id: segment.id,
              visual: segment.visual,
              artStyle: 'cinematic photography with soft lighting'
            },
            hasExistingImages: !!flowData.images[segment.id]
          },
        });
        newEdges.push({
          id: `segment-${segment.id}-to-add-image-${segment.id}`,
          source: `segment-${segment.id}`,
          target: `add-image-${segment.id}`,
          sourceHandle: 'output',
          targetHandle: 'input',
          style: { stroke: "#8b5cf6", strokeWidth: 3 }
        });
        // If segment has images, stack them vertically to the right of add image node
        const imageDetail = flowData.imageDetails[segment.id];
        if (flowData.images[segment.id] && imageDetail?.allImages) {
          imageDetail.allImages.forEach((image, imageIndex) => {
            const imageX = addImageX + nodeSpacing;
            const imageY = y + imageIndex * rowSpacing; // <--- THIS IS THE KEY
            newNodes.push({
              id: `image-${segment.id}-${image.id}`,
              type: "imageNode",
              position: { x: imageX, y: imageY },
              data: {
                segmentId: segment.id,
                imageUrl: image.url,
                imageId: image.id,
                isPrimary: image.isPrimary,
                allImages: imageDetail.allImages,
                segmentData: {
                  id: segment.id,
                  visual: image.visualPrompt || segment.visual,
                  animation: segment.animation,
                  artStyle: image.artStyle || 'cinematic photography with soft lighting'
                }
              },
            });
            newEdges.push({
              id: `add-image-${segment.id}-to-image-${segment.id}-${image.id}`,
              source: `add-image-${segment.id}`,
              target: `image-${segment.id}-${image.id}`,
              sourceHandle: 'output',
              targetHandle: 'input',
              style: { stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "5,5" }
            });
            // Video/add-video node to the right of each image
            const imageVideoUrl = flowData.videos[`${segment.id}-${image.id}`] || flowData.videos[segment.id];
            const imageVideoId = flowData?.videoDetails?.[`${segment.id}-${image.id}`]?.id || flowData?.videoDetails?.[segment.id]?.id;
            const videoX = imageX + nodeSpacing;
            if (imageVideoUrl) {
              newNodes.push({
                id: `video-${segment.id}-${image.id}`,
                type: "videoNode",
                position: { x: videoX, y: imageY },
                data: {
                  segmentId: segment.id,
                  imageId: image.id,
                  videoUrl: imageVideoUrl,
                  videoId: imageVideoId,
                  segmentData: {
                    id: segment.id,
                    animation: segment.animation,
                    artStyle: flowData?.videoDetails?.[segment.id]?.artStyle || 'cinematic photography with soft lighting',
                    imageS3Key: image.s3Key,
                  },
                },
              });
              newEdges.push({
                id: `image-${segment.id}-${image.id}-to-video-${segment.id}-${image.id}`,
                source: `image-${segment.id}-${image.id}`,
                target: `video-${segment.id}-${image.id}`,
                sourceHandle: 'output',
                targetHandle: 'input',
                style: { stroke: "#10b981", strokeWidth: 3 },
              });
            } else {
              newNodes.push({
                id: `add-video-${segment.id}-${image.id}`,
                type: "addVideoNode",
                position: { x: videoX, y: imageY },
                data: {
                  segmentId: segment.id,
                  imageId: image.id,
                  segmentData: {
                    id: segment.id,
                    animation: segment.animation,
                    artStyle: image.artStyle || 'cinematic photography with soft lighting'
                  }
                },
              });
              newEdges.push({
                id: `image-${segment.id}-${image.id}-to-add-video-${segment.id}-${image.id}`,
                source: `image-${segment.id}-${image.id}`,
                target: `add-video-${segment.id}-${image.id}`,
                sourceHandle: 'output',
                targetHandle: 'input',
                style: { stroke: "#10b981", strokeWidth: 2, strokeDasharray: "5,5" },
              });
            }
          });
        }
      });
    }
    
    setNodes(newNodes);
    setEdges(newEdges);
  }, [flowData, setNodes, setEdges]);

  // Add a stable callback to refresh project data after edit
  const handleAfterImageEdit = useCallback(async () => {
    await refreshProjectData();
  }, [refreshProjectData]);

  // Function to fetch project segmentations and related images/videos
  const fetchAllProjectData = useCallback(async () => {
    if (!isAuthenticated) {
      console.log("User not authenticated, skipping API calls");
      return;
    }

    // Get project ID from localStorage
    let projectId;
    try {
      const storedProject = localStorage.getItem('project-store-selectedProject');
      if (storedProject) {
        const project = JSON.parse(storedProject);
        projectId = project.id;
      }
    } catch (error) {
      console.error("Error parsing project from localStorage:", error);
    }

    if (!projectId) {
      console.log("No project ID found in localStorage");
      setError("No project selected. Please select a project first.");
      return;
    }

    console.log("Fetching project segmentations and related images/videos for project ID:", projectId);
    try {
      setLoading(true);
      
      // Fetch project segmentations, images, and videos in parallel
      const [
        segmentationsData,
        imagesData,
        videosData
      ] = await Promise.all([
        projectApi.getProjectSegmentations(projectId),
        projectApi.getProjectImages(projectId),
        projectApi.getProjectVideos(projectId)
      ]);

      console.log("Project data fetched successfully:");
      console.log("Segmentations:", segmentationsData);
      console.log("Images:", imagesData);
      console.log("Videos:", videosData);

      // Extract segments from the first segmentation
      let segments = [];
      if (segmentationsData && segmentationsData.success && segmentationsData.data && segmentationsData.data.length > 0) {
        const firstSegmentation = segmentationsData.data[0];
        if (firstSegmentation.segments && Array.isArray(firstSegmentation.segments)) {
          segments = firstSegmentation.segments;
        }
      }

      setAllProjectData({
        segments: segments,
        images: imagesData?.data || [],
        videos: videosData?.data || []
      });

      // Keep the old projectData for backward compatibility
      setProjectData({ success: true, project: { segments: segments } });
      
    } catch (error) {
      console.error("Failed to fetch project data:", error);
      setError("Failed to fetch project data");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Update nodeTypes to pass onAfterEdit to ImageNode and VideoNode
  const nodeTypeMap = useMemo(() => ({
    segmentNode: SegmentNode,
    imageNode: (props) => <ImageNode {...props} onRegenerateImage={handleRegenerateImage} regeneratingImages={regeneratingImages} onAfterEdit={handleAfterImageEdit} onMakePrimary={handleMakePrimary} isPrimary={props.data?.isPrimary} />,
    videoNode: (props) => <VideoNode {...props} onRegenerateVideo={handleRegenerateVideo} regeneratingVideos={regeneratingVideos} onAfterEdit={handleAfterImageEdit} />,
    addImageNode: (props) => <AddImageNode {...props} onCreateNewImage={handleCreateNewImage} creatingImages={creatingImages} hasExistingImages={props.data?.hasExistingImages} />,
    addVideoNode: (props) => <AddVideoNode {...props} onCreateNewVideo={handleCreateNewVideo} creatingVideos={creatingVideos} />,
  }), [handleRegenerateImage, regeneratingImages, handleAfterImageEdit, handleRegenerateVideo, regeneratingVideos, handleCreateNewImage, creatingImages, handleMakePrimary, handleCreateNewVideo, creatingVideos]);

  // Initialize flow when data changes
  useEffect(() => {
    createFlowElements();
  }, [createFlowElements, projectData]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const handleFlowAction = async (action) => {
    if (!isAuthenticated) return;

    setLoading(true);
    setError(null);

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000)); // simulate

      setFlowMessages((prev) => [
        ...prev,
        {
          type: "assistant",
          content: `Flow action "${action}" completed successfully!`,
        },
      ]);
    } catch (error) {
      setError(error.message || "Flow action failed");
    } finally {
      setLoading(false);
    }
  };

  const getWorkflowStats = () => {
    const totalSegments = flowData.segments.length;
    const imagesGenerated = Object.keys(flowData.images).length;
    const videosGenerated = Object.keys(flowData.videos).length;
    
    return {
      totalSegments,
      imagesGenerated,
      videosGenerated,
      completionRate: totalSegments > 0 ? Math.round((videosGenerated / totalSegments) * 100) : 0,
    };
  };

  const stats = getWorkflowStats();

  // Debug logging
  console.log("🔍 FlowWidget Debug Info:");
  console.log("- isAuthenticated:", isAuthenticated);
  console.log("- loading:", loading);
  console.log("- error:", error);
  console.log("- flowData.segments.length:", flowData.segments.length);
  console.log("- stats:", stats);

  useEffect(() => {
    console.log("🔄 FlowWidget: fetchAllProjectData called");
    fetchAllProjectData();
  }, [fetchAllProjectData]);

    return (
    <div className="fixed inset-0 bg-[#0d0d0d] text-white flex flex-col z-[10000]">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-gray-900">
        <h2 className="text-lg font-semibold">Video Creation Flow</h2>
        <div className="flex items-center gap-3">
          {isAuthenticated && user && (
            <div className="flex items-center gap-2">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt="Profile"
                  className="w-6 h-6 rounded-full border border-gray-600"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center">
                  <span className="text-white text-xs font-medium">
                    {user.name?.charAt(0) || user.email?.charAt(0) || "U"}
                  </span>
                </div>
              )}
              <span className="text-gray-300 text-sm hidden sm:block">
                {user.name || user.email}
              </span>
            </div>
          )}
          <LoginLogoutButton />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 flex flex-col">
          {/* Stats bar */}
          {isAuthenticated && stats.totalSegments > 0 && (
            <div className="p-4 border-b border-gray-800 bg-gray-900">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300">Workflow Progress</h3>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-400">
                    Segments: <span className="text-white">{stats.totalSegments}</span>
                  </span>
                  <span className="text-gray-400">
                    Images: <span className="text-yellow-400">{stats.imagesGenerated}</span>
                  </span>
                  <span className="text-gray-400">
                    Videos: <span className="text-green-400">{stats.videosGenerated}</span>
                  </span>
                  <span className="text-gray-400">
                    Completion: <span className="text-purple-400">{stats.completionRate}%</span>
                  </span>
                  {temporaryVideos.size > 0 && (
                    <button
                      onClick={() => setTemporaryVideos(new Map())}
                      className="text-yellow-400 hover:text-yellow-300 text-xs underline"
                      title="Clear temporary videos"
                    >
                      Clear Previews ({temporaryVideos.size})
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Model Selection */}
          {isAuthenticated && (
            <div className="p-4 border-b border-gray-800 bg-gray-900">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">AI Model Selection</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Image Generation Model</label>
                  <ModelSelector
                    genType="IMAGE"
                    selectedModel={selectedImageModel}
                    onModelChange={setSelectedImageModel}
                    disabled={loading}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Video Generation Model</label>
                  <ModelSelector
                    genType="VIDEO"
                    selectedModel={selectedVideoModel}
                    onModelChange={setSelectedVideoModel}
                    disabled={loading}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {isAuthenticated && (
            <div className="p-4 border-b border-gray-800 bg-gray-900">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleFlowAction("Refresh Data")}
                  disabled={loading}
                  className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <LoadingSpinner />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <span>🔄</span>
                      <span>Refresh Data</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleFlowAction("Clear All")}
                  disabled={loading}
                  className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <span>🗑️</span>
                  <span>Clear All</span>
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <LoadingSpinner />
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-red-400 text-center p-4">
                  <p>{error}</p>
                  <button
                    onClick={() => setError(null)}
                    className="mt-2 text-sm text-purple-400 hover:text-purple-300"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : !isAuthenticated ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center p-8 bg-gray-800 border border-gray-700 rounded-lg max-w-md">
                  <div className="mb-6">
                    <h3 className="text-2xl font-semibold text-white mb-4">
                      Video Creation Flow
                    </h3>
                    <p className="text-gray-400 text-lg mb-6">
                      Sign in to visualize your video creation workflow
                    </p>
                  </div>
                  <ChatLoginButton />
                </div>
              </div>
            ) : flowData.segments.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center p-8 bg-gray-800 border border-gray-700 rounded-lg max-w-md">
                  <h3 className="text-2xl font-semibold text-white mb-4">
                    Welcome to Flow Editor
                  </h3>
                  <p className="text-gray-400 text-lg mb-6">
                    Start creating a video in the chat widget to see your workflow here.
                  </p>
                  <div className="space-y-4">
                    <button
                      onClick={() => handleFlowAction("Refresh Data")}
                      disabled={loading}
                      className="w-full bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-md font-medium transition-colors disabled:opacity-50"
                    >
                      {loading ? (
                        <div className="flex items-center justify-center gap-2">
                          <LoadingSpinner />
                          <span>Processing...</span>
                        </div>
                      ) : (
                        "🔄 Refresh Data"
                      )}
                    </button>
                    <p className="text-gray-500 text-sm">
                      Switch to chat mode to create your first video project
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-full h-full min-h-0">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  nodeTypes={nodeTypeMap}
                  fitView
                  attributionPosition="bottom-left"
                  edgesFocusable={true}
                  edgesUpdatable={true}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background 
                    color="#374151" 
                    gap={20} 
                    variant="dots"
                  />
                  <Controls className="!bg-gray-800 !border-gray-700 !rounded-lg [&>button]:!bg-gray-700 [&>button]:!text-white [&>button]:!border-gray-600 [&>button:hover]:!bg-gray-600" />
                  <MiniMap 
                    className="bg-gray-800 border border-gray-700 rounded-lg"
                    nodeColor="#8b5cf6"
                    maskColor="rgba(0, 0, 0, 0.5)"
                  />
                </ReactFlow>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FlowWidget;