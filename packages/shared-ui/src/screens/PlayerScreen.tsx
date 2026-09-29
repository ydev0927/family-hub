import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, Platform, StyleSheet } from 'react-native';
import { SpatialNavigationRoot } from 'react-tv-space-navigation';
import { useIsFocused } from '@react-navigation/native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import RemoteControlManager from '../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import VideoOverlay from '../components/player/VideoOverlay';
import { VideoRef } from 'react-native-video';
import VideoPlayer from '../components/player/VideoPlayer';
import { RootStackParamList } from '../navigation/types';
import { playbackControl } from '../dashboard/playbackControl';

const SHOW_NATIVE_CONTROLS = Platform.OS === 'ios';

type PlayerScreenRouteProp = RouteProp<RootStackParamList, 'Player'>;
type PlayerScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Player'>;

export default function PlayerScreen() {
  const route = useRoute<PlayerScreenRouteProp>();
  const navigation = useNavigation<PlayerScreenNavigationProp>();
  const { movie, headerImage, loop = false } = route.params;
  const isFocused = useIsFocused();
  const [paused, setPaused] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(false);
  const [isVideoBuffering, setIsVideoBuffering] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const videoRef = useRef<VideoRef>(null);
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);

  const showControls = useCallback(() => {
    setControlsVisible(true);

    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
    }
    hideControlsTimeoutRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 5000);
  }, []);

  const seek = useCallback((time: number) => {
    if (time < 0) {
      time = 0;
    } else if (time > durationRef.current) {
      time = durationRef.current;
    }
    videoRef.current?.seek(time);
    currentTimeRef.current = time;
    setCurrentTime(time);
    showControls();
  }, [showControls]);

  // Set when the breaking-news interrupt paused the programme; the viewer taking over clears it.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const pausedByInterrupt = useRef(false);

  const togglePausePlay = useCallback(() => {
    pausedByInterrupt.current = false;
    setPaused((prev) => !prev);
    showControls();
  }, [showControls]);

  useEffect(() => {
    if (SHOW_NATIVE_CONTROLS) return;

    const handleKeyDown = (key: SupportedKeys) => {
      switch (key) {
        case SupportedKeys.Right:
        case SupportedKeys.Rewind:
          seek(currentTimeRef.current + 10);
          break;
        case SupportedKeys.Left:
        case SupportedKeys.FastForward:
          seek(currentTimeRef.current - 10);
          break;
        case SupportedKeys.Back:
          navigation.goBack();
          break;
        case SupportedKeys.PlayPause:
          togglePausePlay();
          break;
        default:
          showControls();
          break;
      }
    };

    const listener = RemoteControlManager.addKeydownListener(handleKeyDown);
    return () => {
      RemoteControlManager.removeKeydownListener(listener);
    };
  }, [seek, togglePausePlay, showControls, navigation]);

  // The breaking-news interrupt stage pauses the programme, and dismissing it resumes the programme
  // (only if it was the interrupt that paused it).
  useEffect(() => {
    const offPause = playbackControl.onPause(() => {
      if (!pausedRef.current) pausedByInterrupt.current = true;
      setPaused(true);
    });
    const offResume = playbackControl.onResume(() => {
      if (!pausedByInterrupt.current) return;
      pausedByInterrupt.current = false;
      setPaused(false);
    });
    return () => {
      offPause();
      offResume();
    };
  }, []);

  // Show controls when video starts
  useEffect(() => {
    if (durationRef.current && !SHOW_NATIVE_CONTROLS) {
      showControls();
    }
  }, [durationRef.current, showControls]);

  return (
    <SpatialNavigationRoot isActive={isFocused && Platform.OS === 'android'}>
      <View style={playerStyles.container}>
        <VideoPlayer
          ref={videoRef}
          movie={movie}
          headerImage={headerImage}
          paused={paused}
          controls={SHOW_NATIVE_CONTROLS}
          onBuffer={setIsVideoBuffering}
          onProgress={setCurrentTime}
          onLoad={(duration) => (durationRef.current = duration)}
          repeat={loop}
          onEnd={() => {
            if (loop) return;
            setPaused(true);
            navigation.goBack();
          }}
        />

        {!SHOW_NATIVE_CONTROLS && !!durationRef.current && (
          <VideoOverlay
            visible={controlsVisible}
            paused={paused}
            onPlayPause={togglePausePlay}
            onExit={() => navigation.goBack()}
            currentTime={currentTime}
            duration={durationRef.current}
            isBuffering={isVideoBuffering}
          />
        )}
      </View>
    </SpatialNavigationRoot>
  );
}

const playerStyles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#000',
    },
    controlsContainer: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'space-between',
      zIndex: 1,
    },
  });
