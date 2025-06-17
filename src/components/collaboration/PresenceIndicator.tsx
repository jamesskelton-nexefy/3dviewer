import React, { useState, useEffect } from 'react'
import { UserPresence } from '@/services/annotations/CollaborativeAnnotationService'
import { formatDistanceToNow } from 'date-fns'

export interface PresenceIndicatorProps {
  users: UserPresence[]
  currentUserId: string
  maxVisible?: number
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  showActivity?: boolean
  showCursors?: boolean
  onUserClick?: (user: UserPresence) => void
  onToggleCursor?: (userId: string, visible: boolean) => void
  className?: string
}

const PresenceIndicator: React.FC<PresenceIndicatorProps> = ({
  users,
  currentUserId,
  maxVisible = 5,
  position = 'top-right',
  showActivity = true,
  showCursors = true,
  onUserClick,
  onToggleCursor,
  className = ''
}) => {
  const [expandedUsers, setExpandedUsers] = useState(false)
  const [cursorVisibility, setCursorVisibility] = useState<Record<string, boolean>>({})
  const [hoveredUser, setHoveredUser] = useState<string | null>(null)

  // Filter out current user and sort by activity
  const otherUsers = users
    .filter(user => user.userId !== currentUserId)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())

  const visibleUsers = expandedUsers ? otherUsers : otherUsers.slice(0, maxVisible)
  const hiddenCount = otherUsers.length - maxVisible

  // Position classes
  const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4'
  }

  // Initialize cursor visibility
  useEffect(() => {
    const visibility: Record<string, boolean> = {}
    users.forEach(user => {
      if (user.userId !== currentUserId) {
        visibility[user.userId] = cursorVisibility[user.userId] !== false
      }
    })
    setCursorVisibility(visibility)
  }, [users])

  const handleToggleCursor = (userId: string) => {
    const newVisibility = !cursorVisibility[userId]
    setCursorVisibility(prev => ({ ...prev, [userId]: newVisibility }))
    onToggleCursor?.(userId, newVisibility)
  }

  const getUserInitials = (name: string): string => {
    const parts = name.split(' ')
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }

  const getActivityStatus = (lastActivity: Date): {
    status: 'active' | 'idle' | 'away'
    text: string
  } => {
    const now = new Date()
    const diff = now.getTime() - new Date(lastActivity).getTime()
    const minutes = diff / 60000

    if (minutes < 1) {
      return { status: 'active', text: 'Active now' }
    } else if (minutes < 5) {
      return { status: 'idle', text: formatDistanceToNow(lastActivity, { addSuffix: true }) }
    } else {
      return { status: 'away', text: formatDistanceToNow(lastActivity, { addSuffix: true }) }
    }
  }

  return (
    <div className={`fixed ${positionClasses[position]} z-50 ${className}`}>
      <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3 min-w-[200px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            Active Users ({otherUsers.length + 1})
          </h3>
          {showCursors && (
            <button
              className="text-xs text-gray-500 hover:text-gray-700"
              onClick={() => setExpandedUsers(!expandedUsers)}
            >
              {expandedUsers ? 'Show less' : 'Show all'}
            </button>
          )}
        </div>

        {/* Current user */}
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-200">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-medium">
              You
            </div>
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
          </div>
          <span className="text-sm font-medium text-gray-700">You</span>
        </div>

        {/* Other users */}
        <div className="space-y-2">
          {visibleUsers.map(user => {
            const activity = getActivityStatus(user.lastActivity)
            const initials = getUserInitials(user.userName)
            const isHovered = hoveredUser === user.userId
            
            return (
              <div
                key={user.userId}
                className="flex items-center gap-2 group cursor-pointer hover:bg-gray-50 rounded p-1 -m-1"
                onMouseEnter={() => setHoveredUser(user.userId)}
                onMouseLeave={() => setHoveredUser(null)}
                onClick={() => onUserClick?.(user)}
              >
                {/* Avatar */}
                <div className="relative">
                  <div 
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                    style={{ backgroundColor: user.cursor?.color || '#9CA3AF' }}
                  >
                    {initials}
                  </div>
                  <div 
                    className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${
                      activity.status === 'active' ? 'bg-green-500' :
                      activity.status === 'idle' ? 'bg-yellow-500' : 'bg-gray-400'
                    }`}
                  />
                </div>

                {/* User info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 truncate">
                      {user.userName}
                    </span>
                    {user.selectedAnnotation && (
                      <span className="text-xs text-gray-500" title="Viewing annotation">
                        📍
                      </span>
                    )}
                  </div>
                  {showActivity && (
                    <span className="text-xs text-gray-500">
                      {activity.text}
                    </span>
                  )}
                </div>

                {/* Cursor toggle */}
                {showCursors && (
                  <button
                    className={`opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded ${
                      cursorVisibility[user.userId] 
                        ? 'text-blue-600 hover:bg-blue-50' 
                        : 'text-gray-400 hover:bg-gray-100'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleCursor(user.userId)
                    }}
                    title={cursorVisibility[user.userId] ? 'Hide cursor' : 'Show cursor'}
                  >
                    <svg 
                      className="w-4 h-4" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" 
                      />
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" 
                      />
                    </svg>
                  </button>
                )}
              </div>
            )
          })}

          {/* Show more indicator */}
          {!expandedUsers && hiddenCount > 0 && (
            <button
              className="w-full text-left text-xs text-gray-500 hover:text-gray-700 pt-1"
              onClick={() => setExpandedUsers(true)}
            >
              +{hiddenCount} more {hiddenCount === 1 ? 'user' : 'users'}
            </button>
          )}
        </div>

        {/* Tooltip */}
        {isHovered && hoveredUser && (
          <div className="absolute z-10 bg-gray-900 text-white text-xs rounded px-2 py-1 mt-1 pointer-events-none">
            {users.find(u => u.userId === hoveredUser)?.cursor && (
              <>
                Cursor at: {
                  users.find(u => u.userId === hoveredUser)?.cursor?.x.toFixed(1)
                }, {
                  users.find(u => u.userId === hoveredUser)?.cursor?.y.toFixed(1)
                }, {
                  users.find(u => u.userId === hoveredUser)?.cursor?.z.toFixed(1)
                }
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default PresenceIndicator