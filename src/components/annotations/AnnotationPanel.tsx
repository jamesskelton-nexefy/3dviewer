import React, { useState, useRef, useEffect } from 'react'
import {
  Annotation3D,
  AnnotationType,
  AnnotationFilter,
  AnnotationStatus,
  AnnotationThread,
  AnnotationContent,
} from '@/types/annotations'
import { formatDistanceToNow } from 'date-fns'

interface AnnotationPanelProps {
  selectedAnnotation: Annotation3D | null
  annotations: Annotation3D[]
  currentUserId: string
  onUpdateAnnotation: (id: string, updates: Partial<Annotation3D>) => Promise<void>
  onDeleteAnnotation: (id: string) => Promise<void>
  onAddComment: (
    annotationId: string,
    message: string,
    richText?: string,
    parentCommentId?: string
  ) => Promise<void>
  onSelectAnnotation: (annotation: Annotation3D | null) => void
  onCreateAnnotation: (type: AnnotationType) => void
  onFilterChange: (filter: AnnotationFilter | null) => void
}

export const AnnotationPanel: React.FC<AnnotationPanelProps> = ({
  selectedAnnotation,
  annotations,
  currentUserId,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onAddComment,
  onSelectAnnotation,
  onCreateAnnotation,
  onFilterChange,
}) => {
  const [activeTab, setActiveTab] = useState<'list' | 'details'>('list')
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState<AnnotationContent | null>(null)
  const [commentText, setCommentText] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [filter, setFilter] = useState<AnnotationFilter>({})
  const [searchText, setSearchText] = useState('')
  const commentInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (selectedAnnotation) {
      setActiveTab('details')
      setEditedContent(selectedAnnotation.content)
    }
  }, [selectedAnnotation])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      onFilterChange({ ...filter, searchText: searchText || undefined })
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [filter, searchText, onFilterChange])

  const handleSaveEdit = async () => {
    if (!selectedAnnotation || !editedContent) return

    await onUpdateAnnotation(selectedAnnotation.id, {
      content: editedContent,
    })
    setIsEditing(false)
  }

  const handleAddComment = async () => {
    if (!selectedAnnotation || !commentText.trim()) return

    await onAddComment(
      selectedAnnotation.id,
      commentText.trim(),
      undefined,
      replyingTo || undefined
    )

    setCommentText('')
    setReplyingTo(null)
  }

  const handleStatusChange = async (status: AnnotationStatus) => {
    if (!selectedAnnotation) return

    await onUpdateAnnotation(selectedAnnotation.id, { status })
  }

  const handlePriorityChange = async (priority: AnnotationContent['priority']) => {
    if (!selectedAnnotation) return

    await onUpdateAnnotation(selectedAnnotation.id, {
      content: { ...selectedAnnotation.content, priority },
    })
  }

  const renderAnnotationTypes = () => {
    const types: { type: AnnotationType; label: string; icon: string }[] = [
      { type: 'point', label: 'Point', icon: '📍' },
      { type: 'area', label: 'Area', icon: '⬛' },
      { type: 'measurement', label: 'Measure', icon: '📏' },
      { type: 'section', label: 'Section', icon: '✂️' },
      { type: 'markup', label: 'Markup', icon: '✏️' },
    ]

    return (
      <div className="flex gap-2 p-4 border-b">
        {types.map(({ type, label, icon }) => (
          <button
            key={type}
            onClick={() => onCreateAnnotation(type)}
            className="flex items-center gap-2 px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
          >
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    )
  }

  const renderFilters = () => (
    <div className="p-4 border-b space-y-3">
      <input
        type="text"
        placeholder="Search annotations..."
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      
      <div className="flex gap-2 flex-wrap">
        <select
          onChange={(e) => setFilter({ ...filter, types: e.target.value ? [e.target.value as AnnotationType] : undefined })}
          className="px-3 py-1 border rounded"
        >
          <option value="">All Types</option>
          <option value="point">Point</option>
          <option value="area">Area</option>
          <option value="measurement">Measurement</option>
          <option value="section">Section</option>
          <option value="markup">Markup</option>
        </select>

        <select
          onChange={(e) => setFilter({ ...filter, status: e.target.value ? [e.target.value as AnnotationStatus] : undefined })}
          className="px-3 py-1 border rounded"
        >
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>

        <select
          onChange={(e) => setFilter({ ...filter, priority: e.target.value ? [e.target.value as any] : undefined })}
          className="px-3 py-1 border rounded"
        >
          <option value="">All Priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
    </div>
  )

  const renderAnnotationList = () => (
    <div className="flex-1 overflow-y-auto">
      {annotations.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          No annotations yet. Create one using the buttons above.
        </div>
      ) : (
        <div className="divide-y">
          {annotations.map((annotation) => (
            <div
              key={annotation.id}
              onClick={() => onSelectAnnotation(annotation)}
              className={`p-4 cursor-pointer hover:bg-gray-50 transition ${
                selectedAnnotation?.id === annotation.id ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="font-medium">{annotation.content.title}</h4>
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                    {annotation.content.description}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                    <span>{annotation.userName}</span>
                    <span>{formatDistanceToNow(annotation.createdAt)} ago</span>
                    {annotation.thread.length > 0 && (
                      <span className="text-blue-600">
                        {annotation.thread.length} comments
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-3">
                  <span className={`inline-block px-2 py-1 text-xs rounded ${getStatusColor(annotation.status)}`}>
                    {annotation.status}
                  </span>
                  {annotation.content.priority && (
                    <span className={`inline-block px-2 py-1 text-xs rounded mt-1 ${getPriorityColor(annotation.content.priority)}`}>
                      {annotation.content.priority}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const renderAnnotationDetails = () => {
    if (!selectedAnnotation) return null

    return (
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              {isEditing ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editedContent?.title || ''}
                    onChange={(e) => setEditedContent({ ...editedContent!, title: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    value={editedContent?.description || ''}
                    onChange={(e) => setEditedContent({ ...editedContent!, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setIsEditing(false)
                        setEditedContent(selectedAnnotation.content)
                      }}
                      className="px-3 py-1 border rounded hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="text-lg font-semibold">{selectedAnnotation.content.title}</h3>
                  <p className="text-gray-600 mt-2">{selectedAnnotation.content.description}</p>
                  <div className="flex items-center gap-3 mt-3 text-sm text-gray-500">
                    <span>{selectedAnnotation.userName}</span>
                    <span>{formatDistanceToNow(selectedAnnotation.createdAt)} ago</span>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => onSelectAnnotation(null)}
              className="ml-4 text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          {!isEditing && selectedAnnotation.userId === currentUserId && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setIsEditing(true)}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
              >
                Edit
              </button>
              <button
                onClick={() => onDeleteAnnotation(selectedAnnotation.id)}
                className="px-3 py-1 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          )}

          <div className="flex gap-2 mt-4">
            <select
              value={selectedAnnotation.status}
              onChange={(e) => handleStatusChange(e.target.value as AnnotationStatus)}
              className="px-3 py-1 text-sm border rounded"
            >
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>

            <select
              value={selectedAnnotation.content.priority || ''}
              onChange={(e) => handlePriorityChange(e.target.value as any)}
              className="px-3 py-1 text-sm border rounded"
            >
              <option value="">No Priority</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        <div className="p-4">
          <h4 className="font-medium mb-3">Comments ({selectedAnnotation.thread.length})</h4>
          
          <div className="space-y-3">
            {selectedAnnotation.thread.map((comment) => (
              <div key={comment.id} className="bg-gray-50 rounded p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{comment.userName}</span>
                      <span className="text-xs text-gray-500">
                        {formatDistanceToNow(comment.createdAt)} ago
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{comment.message}</p>
                  </div>
                  <button
                    onClick={() => {
                      setReplyingTo(comment.id)
                      commentInputRef.current?.focus()
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Reply
                  </button>
                </div>
                
                {comment.replies && comment.replies.length > 0 && (
                  <div className="ml-4 mt-2 space-y-2">
                    {comment.replies.map((reply) => (
                      <div key={reply.id} className="bg-white rounded p-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-xs">{reply.userName}</span>
                          <span className="text-xs text-gray-500">
                            {formatDistanceToNow(reply.createdAt)} ago
                          </span>
                        </div>
                        <p className="mt-1 text-sm">{reply.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4">
            {replyingTo && (
              <div className="mb-2 text-sm text-blue-600">
                Replying to comment...
                <button
                  onClick={() => setReplyingTo(null)}
                  className="ml-2 text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            )}
            <textarea
              ref={commentInputRef}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment..."
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
            <button
              onClick={handleAddComment}
              disabled={!commentText.trim()}
              className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Comment
            </button>
          </div>
        </div>
      </div>
    )
  }

  const getStatusColor = (status: AnnotationStatus) => {
    switch (status) {
      case 'open':
        return 'bg-blue-100 text-blue-800'
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800'
      case 'resolved':
        return 'bg-green-100 text-green-800'
      case 'closed':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'bg-red-100 text-red-800'
      case 'high':
        return 'bg-orange-100 text-orange-800'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800'
      case 'low':
        return 'bg-green-100 text-green-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-lg">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-xl font-semibold">Annotations</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('list')}
            className={`px-3 py-1 rounded ${
              activeTab === 'list' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            List ({annotations.length})
          </button>
          {selectedAnnotation && (
            <button
              onClick={() => setActiveTab('details')}
              className={`px-3 py-1 rounded ${
                activeTab === 'details' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Details
            </button>
          )}
        </div>
      </div>

      {renderAnnotationTypes()}

      {activeTab === 'list' ? (
        <>
          {renderFilters()}
          {renderAnnotationList()}
        </>
      ) : (
        renderAnnotationDetails()
      )}
    </div>
  )
}

export default AnnotationPanel