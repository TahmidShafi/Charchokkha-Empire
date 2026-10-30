import React from 'react';

export interface PlayerCharacterProps {
  color: string;
  size?: number;
  isSelected?: boolean;
  isTaken?: boolean;
  isHopping?: boolean;
  showGlow?: boolean;
  className?: string;
  title?: string;
  onClick?: () => void;
  tabIndex?: number;
  role?: string;
  ariaLabel?: string;
  variant?: 'figurine' | 'blob';
}

/**
 * Human-like animated miniature player figurine.
 * Fully filled with the player's chosen color, with scalable SVG rendering.
 */
export const PlayerCharacter: React.FC<PlayerCharacterProps> = ({
  color,
  size = 28,
  isSelected = false,
  isTaken = false,
  isHopping = false,
  showGlow = false,
  className = '',
  title,
  onClick,
  tabIndex,
  role,
  ariaLabel,
  variant = 'figurine',
}) => {
  if (variant === 'blob') {
    return (
      <div
        className={`player-character-wrapper character-blob-wrapper ${isSelected ? 'character-selected' : ''} ${
          isTaken ? 'character-taken' : ''
        } ${isHopping ? 'character-hopping' : ''} ${className}`}
        style={
          {
            width: size,
            height: size,
            '--character-color': color,
          } as React.CSSProperties
        }
        title={title}
        onClick={onClick}
        tabIndex={tabIndex}
        role={role}
        aria-label={ariaLabel}
      >
        {(isSelected || showGlow) && (
          <div
            className="character-glow-ring"
            style={{
              boxShadow: `0 0 12px ${color}`,
              borderColor: color,
              borderRadius: '50%',
            }}
            aria-hidden="true"
          />
        )}
        <svg
          viewBox="0 0 32 32"
          width={size}
          height={size}
          className="character-blob-svg"
          aria-hidden="true"
        >
          {/* Main Body Circle */}
          <circle cx="16" cy="16" r="14.5" fill={color} />

          {/* Top Googly Eye */}
          <circle cx="20.5" cy="11.5" r="4.2" fill="#ffffff" />
          <circle cx="22" cy="11.2" r="2.1" fill="#181326" />

          {/* Bottom Googly Eye */}
          <circle cx="20.5" cy="20.5" r="4.2" fill="#ffffff" />
          <circle cx="22" cy="20.2" r="2.1" fill="#181326" />

          {isTaken && (
            <g className="character-taken-mark">
              <line
                x1="6"
                y1="6"
                x2="26"
                y2="26"
                stroke="#ef4444"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </g>
          )}
        </svg>
      </div>
    );
  }

  const height = Math.round(size * 1.25);

  return (
    <div
      className={`player-character-wrapper ${isSelected ? 'character-selected' : ''} ${
        isTaken ? 'character-taken' : ''
      } ${isHopping ? 'character-hopping' : ''} ${className}`}
      style={
        {
          width: size,
          height: height,
          '--character-color': color,
        } as React.CSSProperties
      }
      title={title}
      onClick={onClick}
      tabIndex={tabIndex}
      role={role}
      aria-label={ariaLabel}
    >
      {/* Soft Glow Ring if selected or requested */}
      {(isSelected || showGlow) && (
        <div
          className="character-glow-ring"
          style={{
            boxShadow: `0 0 14px ${color}`,
            borderColor: color,
          }}
          aria-hidden="true"
        />
      )}

      {/* Scalable Human Figurine SVG */}
      <svg
        viewBox="0 0 36 44"
        width={size}
        height={height}
        className="character-svg"
        aria-hidden="true"
      >
        {/* Ground shadow beneath feet */}
        <ellipse cx="18" cy="41" rx="8" ry="2.2" fill="rgba(0, 0, 0, 0.35)" />

        {/* Left Leg */}
        <rect
          x="12"
          y="27"
          width="4.2"
          height="12"
          rx="2.1"
          fill={color}
          stroke="rgba(0,0,0,0.2)"
          strokeWidth="0.5"
        />

        {/* Right Leg */}
        <rect
          x="19.8"
          y="27"
          width="4.2"
          height="12"
          rx="2.1"
          fill={color}
          stroke="rgba(0,0,0,0.2)"
          strokeWidth="0.5"
        />

        {/* Left Arm */}
        <path
          d="M11 16.5 C8.2 18, 7.2 22, 8.2 25.5 C8.5 26.8, 10.2 26.8, 10.6 25.5 C11.3 22.8, 12 19, 13 17 Z"
          fill={color}
          stroke="rgba(0,0,0,0.2)"
          strokeWidth="0.5"
        />

        {/* Right Arm */}
        <path
          d="M25 16.5 C27.8 18, 28.8 22, 27.8 25.5 C27.5 26.8, 25.8 26.8, 25.4 25.5 C24.7 22.8, 24 19, 23 17 Z"
          fill={color}
          stroke="rgba(0,0,0,0.2)"
          strokeWidth="0.5"
        />

        {/* Torso / Body */}
        <path
          d="M11 17 C11 14.5, 13.5 13.5, 18 13.5 C22.5 13.5, 25 14.5, 25 17 L25.5 28.5 C25.5 29.8, 23.5 30.8, 18 30.8 C12.5 30.8, 10.5 29.8, 10.5 28.5 Z"
          fill={color}
          stroke="rgba(0,0,0,0.2)"
          strokeWidth="0.5"
        />

        {/* Torso 3D curve depth */}
        <path
          d="M11.5 27 C13.5 29, 22.5 29, 24.5 27 C24.5 28.8, 22.5 30.5, 18 30.5 C13.5 30.5, 11.5 28.8, 11.5 27 Z"
          fill="rgba(0, 0, 0, 0.18)"
        />

        {/* Head */}
        <circle
          cx="18"
          cy="8.5"
          r="6.2"
          fill={color}
          stroke="rgba(0,0,0,0.2)"
          strokeWidth="0.5"
        />

        {/* Glossy highlight on head */}
        <ellipse
          cx="16"
          cy="6.2"
          rx="3.2"
          ry="1.5"
          fill="rgba(255, 255, 255, 0.35)"
          transform="rotate(-20 16 6.2)"
        />

        {/* Facial Expression: Eyes */}
        <circle cx="16" cy="8.2" r="0.9" fill="#181326" />
        <circle cx="20" cy="8.2" r="0.9" fill="#181326" />
        {/* Eye Glint */}
        <circle cx="16.3" cy="7.9" r="0.3" fill="#ffffff" />
        <circle cx="20.3" cy="7.9" r="0.3" fill="#ffffff" />

        {/* Smile */}
        <path
          d="M16.5 10.5 Q18 12.2 19.5 10.5"
          stroke="#181326"
          strokeWidth="0.9"
          strokeLinecap="round"
          fill="none"
        />

        {/* Taken / Disabled Diagonal Cross Indicator */}
        {isTaken && (
          <g className="character-taken-mark">
            <line
              x1="7"
              y1="7"
              x2="29"
              y2="37"
              stroke="#ef4444"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>
        )}
      </svg>
    </div>
  );
};

