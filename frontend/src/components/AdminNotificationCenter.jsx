import React, { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { adminService } from '../services/api.js';

export default function AdminNotificationCenter({ onSelect }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState('idle');
  const [checkedAt, setCheckedAt] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setStatus('loading');
    adminService.getNotifications({ signal: controller.signal })
      .then(({ data }) => {
        setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
        setTotalCount(Number.isSafeInteger(data.totalCount) ? data.totalCount : 0);
        setUnreadCount(Number.isSafeInteger(data.unreadCount) ? data.unreadCount : (data.notifications || []).filter((item) => !item.isRead).length);
        setCheckedAt(new Date());
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [open]);

  const choose = (notification) => {
    onSelect(notification);
    setOpen(false);
  };

  const setReadState = async (notification, isRead) => {
    const previous = notification.isRead;
    setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, isRead } : item));
    setUnreadCount((count) => Math.max(0, count + (isRead ? -1 : 1)));
    try {
      await adminService.updateNotificationReadState(notification.id, isRead);
    } catch {
      setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, isRead: previous } : item));
      setUnreadCount((count) => Math.max(0, count + (isRead ? 1 : -1)));
    }
  };

  return (
    <div className="admin-notification-center" ref={rootRef}>
      <button
        type="button"
        className="admin-notification-center__trigger"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        aria-controls="admin-notification-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 && <span className="admin-notification-center__count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <section className="admin-notification-center__panel" id="admin-notification-panel" aria-label="Notifications">
          <header className="admin-notification-center__header">
            <div>
              <h2>Action centre</h2>
              <p>Orders, stock alerts, and adjustments needing attention</p>
            </div>
            <button type="button" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={16} /></button>
          </header>
          {checkedAt && <p className="admin-notification-center__checked">Live data checked {checkedAt.toLocaleTimeString()}</p>}
          {status === 'loading' && <p className="admin-notification-center__message" role="status">Checking pending tasks…</p>}
          {status === 'error' && <p className="admin-notification-center__message" role="alert">Notifications could not be loaded.</p>}
          {status === 'ready' && totalCount === 0 && <p className="admin-notification-center__message">No pending tasks need attention.</p>}
          {status === 'ready' && notifications.length > 0 && (
            <div className="admin-notification-center__items" role="list">
              {notifications.map((notification) => (
                <div key={notification.id} role="listitem">
                  <button type="button" className={`admin-notification-center__item${notification.isRead ? ' is-read' : ''}`} onClick={() => choose(notification)}>
                    <span className="admin-notification-center__item-title">{notification.title}</span>
                    <span className="admin-notification-center__item-detail">{notification.detail}</span>
                    <span className="admin-notification-center__item-date">{notification.createdAt ? new Date(notification.createdAt).toLocaleString() : 'Date unavailable'}</span>
                  </button>
                  <button type="button" className="admin-notification-center__read-toggle" aria-label={notification.isRead ? 'Mark as unread' : 'Mark as read'} onClick={() => setReadState(notification, !notification.isRead)}>
                    {notification.isRead ? 'Mark unread' : 'Mark read'}
                  </button>
                </div>
              ))}
              {totalCount > notifications.length && <p className="admin-notification-center__message">Showing {notifications.length} of {totalCount} pending tasks.</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
