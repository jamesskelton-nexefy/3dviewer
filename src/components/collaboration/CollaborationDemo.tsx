import React, { useState, useEffect } from 'react'
import { Scene } from '@babylonjs/core'
import { useCollaboration } from '@/hooks/useCollaboration'
import PresenceIndicator from './PresenceIndicator'
import ActivityFeed from './ActivityFeed'
import Cursor3DRenderer from './Cursor3DRenderer'

export interface CollaborationDemoProps {
  scene: Scene
  serverUrl: string
  modelId: string
  userId: string
  userName: string
  token?: string
}

const CollaborationDemo: React.FC<CollaborationDemoProps> = ({
  scene,
  serverUrl,
  modelId,
  userId,
  userName,
  token
}) => {
  const [showDebugInfo, setShowDebugInfo] = useState(false)
  
  const {
    isConnected,
    connectionState,
    cursors,
    presence,
    activities,
    error,
    connect,
    disconnect,
    toggleCursorVisibility,
    markActivityAsRead,
    markAllActivitiesAsRead,
    sendAnnotationUpdate,
    requestSync
  } = useCollaboration(scene, {
    serverUrl,
    modelId,
    userId,
    userName,
    token,
    enableCursors: true,
    enablePresence: true,
    enableActivities: true,
    enableOT: true,
    autoConnect: false
  })

  // Auto-connect on mount
  useEffect(() => {
    connect().catch(console.error)
  }, [])

  // Handle cursor click
  const handleCursorClick = (cursor: any) => {
    console.log('Cursor clicked:', cursor)
    // You could show user info, jump to their view, etc.
  }

  // Handle cursor hover
  const handleCursorHover = (cursor: any) => {
    // Show tooltip or highlight user
  }

  // Handle presence user click
  const handlePresenceUserClick = (user: any) => {
    console.log('User clicked:', user)
    // You could focus on their cursor, show their annotations, etc.
  }

  // Handle activity click
  const handleActivityClick = (activity: any) => {
    console.log('Activity clicked:', activity)
    // Navigate to the related annotation, comment, etc.
  }

  // Handle connection toggle
  const handleConnectionToggle = async () => {
    try {
      if (isConnected) {
        await disconnect()
      } else {
        await connect()
      }
    } catch (err) {
      console.error('Connection error:', err)
    }
  }

  return (
    <>
      {/* 3D Cursor Renderer */}
      {scene && (
        <Cursor3DRenderer
          scene={scene}
          cursors={cursors.filter(c => c.userId !== userId)}
          showLabels={true}
          cursorSize={0.5}
          onCursorClick={handleCursorClick}
          onCursorHover={handleCursorHover}
        />
      )}

      {/* Presence Indicator */}
      <PresenceIndicator
        users={presence}
        currentUserId={userId}
        position="top-right"
        showActivity={true}
        showCursors={true}
        onUserClick={handlePresenceUserClick}
        onToggleCursor={toggleCursorVisibility}
      />

      {/* Activity Feed */}
      <ActivityFeed
        activities={activities}
        currentUserId={userId}
        position="right"
        showNotifications={true}
        autoScroll={true}
        onActivityClick={handleActivityClick}
        onMarkAsRead={markActivityAsRead}
        onMarkAllAsRead={markAllActivitiesAsRead}
      />

      {/* Connection Status */}
      <div className="fixed bottom-4 left-4 z-50">
        <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`} />
            <span className="text-sm font-medium text-gray-700">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            <button
              className="text-xs text-blue-600 hover:text-blue-800"
              onClick={handleConnectionToggle}
            >
              {isConnected ? 'Disconnect' : 'Connect'}
            </button>
          </div>
          
          {/* Error display */}
          {error && (
            <div className="mt-2 text-xs text-red-600">
              {error.message}
            </div>
          )}

          {/* Debug info toggle */}
          <button
            className="mt-2 text-xs text-gray-500 hover:text-gray-700"
            onClick={() => setShowDebugInfo(!showDebugInfo)}
          >
            {showDebugInfo ? 'Hide' : 'Show'} debug info
          </button>
        </div>

        {/* Debug Information */}
        {showDebugInfo && (
          <div className="mt-2 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3 text-xs">
            <h4 className="font-semibold mb-2">Debug Info</h4>
            <div className="space-y-1">
              <div>State: {connectionState.connectionState}</div>
              <div>Active Users: {connectionState.activeUsers}</div>
              <div>Latency: {connectionState.latency}ms</div>
              <div>Pending Ops: {connectionState.pendingOperations}</div>
              <div>Cursors: {cursors.length}</div>
              <div>Activities: {activities.length}</div>
              <div className="pt-1">
                <button
                  className="text-blue-600 hover:text-blue-800"
                  onClick={() => requestSync()}
                >
                  Force Sync
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      {isConnected && cursors.length === 0 && (
        <div className="fixed bottom-4 right-4 z-40 max-w-sm">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-blue-900 mb-1">
              Collaboration Active
            </h4>
            <p className="text-xs text-blue-700">
              Move your mouse over the 3D model to share your cursor position with other users.
              Click on annotations to collaborate in real-time.
            </p>
          </div>
        </div>
      )}
    </>
  )
}

export default CollaborationDemo