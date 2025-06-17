import React, { useState, useEffect, useRef } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AnnotationEvent, AnnotationEventType } from '@/types/annotations'

export interface Activity {
  id: string
  type: ActivityType
  userId: string
  userName: string
  userColor?: string
  timestamp: Date
  data: any
  read?: boolean
}

export type ActivityType = 
  | 'annotation_created'
  | 'annotation_updated'
  | 'annotation_deleted'
  | 'comment_added'
  | 'comment_replied'
  | 'user_joined'
  | 'user_left'
  | 'status_changed'
  | 'model_updated'

export interface ActivityFeedProps {
  activities: Activity[]
  currentUserId: string
  maxItems?: number
  position?: 'left' | 'right'
  width?: number
  onActivityClick?: (activity: Activity) => void
  onMarkAsRead?: (activityId: string) => void
  onMarkAllAsRead?: () => void
  showNotifications?: boolean
  autoScroll?: boolean
  className?: string
}

const ActivityFeed: React.FC<ActivityFeedProps> = ({
  activities,
  currentUserId,
  maxItems = 50,
  position = 'right',
  width = 320,
  onActivityClick,
  onMarkAsRead,
  onMarkAllAsRead,
  showNotifications = true,
  autoScroll = true,
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [filter, setFilter] = useState<ActivityType | 'all'>('all')
  const feedRef = useRef<HTMLDivElement>(null)
  const lastActivityCount = useRef(activities.length)

  // Filter and sort activities
  const filteredActivities = activities
    .filter(activity => filter === 'all' || activity.type === filter)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, maxItems)

  // Count unread activities
  const unreadCount = activities.filter(a => !a.read && a.userId !== currentUserId).length

  // Auto-scroll to bottom when new activities arrive
  useEffect(() => {
    if (autoScroll && activities.length > lastActivityCount.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
    lastActivityCount.current = activities.length
  }, [activities.length, autoScroll])

  // Get activity icon
  const getActivityIcon = (type: ActivityType): string => {
    switch (type) {
      case 'annotation_created': return '📌'
      case 'annotation_updated': return '✏️'
      case 'annotation_deleted': return '🗑️'
      case 'comment_added': return '💬'
      case 'comment_replied': return '↩️'
      case 'user_joined': return '👋'
      case 'user_left': return '👋'
      case 'status_changed': return '🔄'
      case 'model_updated': return '📦'
      default: return '📋'
    }
  }

  // Format activity message
  const formatActivityMessage = (activity: Activity): string => {
    const isCurrentUser = activity.userId === currentUserId
    const userName = isCurrentUser ? 'You' : activity.userName

    switch (activity.type) {
      case 'annotation_created':
        return `${userName} created annotation "${activity.data.title || 'Untitled'}"`
      case 'annotation_updated':
        return `${userName} updated annotation "${activity.data.title || 'Untitled'}"`
      case 'annotation_deleted':
        return `${userName} deleted annotation "${activity.data.title || 'Untitled'}"`
      case 'comment_added':
        return `${userName} commented on "${activity.data.annotationTitle || 'annotation'}"`
      case 'comment_replied':
        return `${userName} replied to a comment`
      case 'user_joined':
        return `${userName} joined the session`
      case 'user_left':
        return `${userName} left the session`
      case 'status_changed':
        return `${userName} changed status to "${activity.data.newStatus}"`
      case 'model_updated':
        return `${userName} updated the model`
      default:
        return `${userName} performed an action`
    }
  }

  // Activity type colors
  const getActivityColor = (type: ActivityType): string => {
    switch (type) {
      case 'annotation_created': return 'text-green-600'
      case 'annotation_updated': return 'text-blue-600'
      case 'annotation_deleted': return 'text-red-600'
      case 'comment_added': return 'text-purple-600'
      case 'comment_replied': return 'text-purple-600'
      case 'user_joined': return 'text-green-600'
      case 'user_left': return 'text-gray-600'
      case 'status_changed': return 'text-orange-600'
      case 'model_updated': return 'text-indigo-600'
      default: return 'text-gray-600'
    }
  }

  return (
    <div 
      className={`fixed top-20 ${position === 'right' ? 'right-4' : 'left-4'} z-40 ${className}`}
      style={{ width: isExpanded ? width : 'auto' }}
    >
      {/* Collapsed state - notification badge */}
      {!isExpanded && (
        <button
          className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3 hover:shadow-xl transition-shadow relative"
          onClick={() => setIsExpanded(true)}
        >
          <span className="text-2xl">📋</span>
          {showNotifications && unreadCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Expanded state - full feed */}
      {isExpanded && (
        <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              Activity Feed
              {unreadCount > 0 && (
                <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && onMarkAllAsRead && (
                <button
                  className="text-xs text-gray-500 hover:text-gray-700"
                  onClick={onMarkAllAsRead}
                >
                  Mark all read
                </button>
              )}
              <button
                className="text-gray-400 hover:text-gray-600"
                onClick={() => setIsExpanded(false)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="px-4 py-2 border-b border-gray-200 flex gap-2 overflow-x-auto">
            <button
              className={`text-xs px-2 py-1 rounded ${
                filter === 'all' ? 'bg-gray-100 text-gray-700' : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              className={`text-xs px-2 py-1 rounded ${
                filter === 'annotation_created' ? 'bg-gray-100 text-gray-700' : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setFilter('annotation_created')}
            >
              Annotations
            </button>
            <button
              className={`text-xs px-2 py-1 rounded ${
                filter === 'comment_added' ? 'bg-gray-100 text-gray-700' : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setFilter('comment_added')}
            >
              Comments
            </button>
            <button
              className={`text-xs px-2 py-1 rounded ${
                filter === 'status_changed' ? 'bg-gray-100 text-gray-700' : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setFilter('status_changed')}
            >
              Status
            </button>
          </div>

          {/* Activity list */}
          <div 
            ref={feedRef}
            className="max-h-96 overflow-y-auto"
            style={{ maxHeight: '400px' }}
          >
            {filteredActivities.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                No activities to show
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredActivities.map(activity => {
                  const isUnread = !activity.read && activity.userId !== currentUserId
                  
                  return (
                    <div
                      key={activity.id}
                      className={`px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                        isUnread ? 'bg-blue-50/50' : ''
                      }`}
                      onClick={() => {
                        onActivityClick?.(activity)
                        if (isUnread) {
                          onMarkAsRead?.(activity.id)
                        }
                      }}
                    >
                      <div className="flex items-start gap-3">
                        {/* Icon */}
                        <span className={`text-lg mt-0.5 ${getActivityColor(activity.type)}`}>
                          {getActivityIcon(activity.type)}
                        </span>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          {/* Message */}
                          <p className="text-sm text-gray-700">
                            {formatActivityMessage(activity)}
                          </p>

                          {/* Additional info */}
                          {activity.data.message && (
                            <p className="text-xs text-gray-500 mt-1 truncate">
                              "{activity.data.message}"
                            </p>
                          )}

                          {/* Timestamp and user */}
                          <div className="flex items-center gap-2 mt-1">
                            {activity.userColor && (
                              <div 
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: activity.userColor }}
                              />
                            )}
                            <span className="text-xs text-gray-400">
                              {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                            </span>
                          </div>
                        </div>

                        {/* Unread indicator */}
                        {isUnread && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full mt-2" />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ActivityFeed