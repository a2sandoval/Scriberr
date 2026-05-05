import { useState, useEffect, useRef } from "react";
import {
	MonitorSpeaker,
	Mic,
	Square,
	Upload,
	Loader2,
	ChevronDown,
	Settings,
	XCircle,
	AlertCircle,
	CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

interface SystemAudioRecorderProps {
	isOpen: boolean;
	onClose: () => void;
	onRecordingComplete: (blob: Blob, title: string) => void;
}

export function SystemAudioRecorder({
	isOpen,
	onClose,
	onRecordingComplete,
}: SystemAudioRecorderProps) {
	// Recording state
	const [isRecording, setIsRecording] = useState(false);
	const [recordingTime, setRecordingTime] = useState(0);
	const [title, setTitle] = useState("");
	const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
	const [showCloseConfirm, setShowCloseConfirm] = useState(false); // New state for confirmation
	const recordingChunksRef = useRef<Blob[]>([]);
	const timerIntervalRef = useRef<number | null>(null);

	// Audio Streams & Web Audio API
	const [systemStream, setSystemStream] = useState<MediaStream | null>(null);
	const [micStream, setMicStream] = useState<MediaStream | null>(null);
	const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
	const [systemGainNode, setSystemGainNode] = useState<GainNode | null>(null);
	const [micGainNode, setMicGainNode] = useState<GainNode | null>(null);

	// Volume Controls
	const [systemVolume, setSystemVolume] = useState(100);
	const [micVolume, setMicVolume] = useState(100);

	// Device Selection
	const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
	const [selectedDevice, setSelectedDevice] = useState("");

	// Audio Settings
	const [autoGainControl, setAutoGainControl] = useState(true);

	// Error & Compatibility
	const [compatibilityError, setCompatibilityError] = useState<string | null>(null);
	const [permissionDenied, setPermissionDenied] = useState(false);
	const [micAvailable, setMicAvailable] = useState(true);

	const { toast } = useToast();

	// Browser compatibility check
	const checkCompatibility = (): { supported: boolean; error?: string } => {
		if (!navigator.mediaDevices?.getDisplayMedia) {
			return {
				supported: false,
				error: "Your browser doesn't support screen capture. Please use Chrome, Edge, or Brave.",
			};
		}

		const userAgent = navigator.userAgent.toLowerCase();
		const isChromium = userAgent.includes('chrome') ||
		                   userAgent.includes('chromium') ||
		                   userAgent.includes('edg/') ||
		                   userAgent.includes('brave');

		if (!isChromium) {
			return {
				supported: false,
				error: "System audio recording is only supported on Chromium-based browsers (Chrome, Edge, Brave).",
			};
		}

		return { supported: true };
	};

	useEffect(() => {
		if (!isOpen) return;

		let activeStream: MediaStream | null = null;

		const init = async () => {
			try {
				const compatibility = checkCompatibility();
				if (!compatibility.supported) {
					setCompatibilityError(compatibility.error || null);
					return;
				}

				activeStream = await navigator.mediaDevices.getUserMedia({
					audio: true,
				});

				const devices = await navigator.mediaDevices.enumerateDevices();
				const audioDevices = devices.filter((d) => d.kind === "audioinput");
				setAvailableDevices(audioDevices);

				if (audioDevices.length > 0) {
					const deviceExists = audioDevices.some(
						(d) => d.deviceId === selectedDevice,
					);
					if (!selectedDevice || !deviceExists) {
						setSelectedDevice(audioDevices[0].deviceId);
					}
				}
			} catch (error) {
				console.error("Failed to enumerate devices:", error);
				toast({
					title: "Initialization Error",
					description: "Failed to get microphone devices. You can still record system audio only.",
				});
			} finally {
				if (activeStream) {
					activeStream.getTracks().forEach((track) => track.stop());
				}
			}
		};

		init();
	}, [isOpen]); 

	useEffect(() => {
		if (isRecording) {
			timerIntervalRef.current = window.setInterval(() => {
				setRecordingTime((prev) => prev + 1000);
			}, 1000);
		} else {
			if (timerIntervalRef.current) {
				clearInterval(timerIntervalRef.current);
				timerIntervalRef.current = null;
			}
		}

		return () => {
			if (timerIntervalRef.current) {
				clearInterval(timerIntervalRef.current);
			}
		};
	}, [isRecording]);

	useEffect(() => {
		const originalTitle = document.title;

		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (isRecording) {
				e.preventDefault();
				e.returnValue = "Recording in progress. Are you sure you want to leave?";
				return e.returnValue;
			}
		};

		if (isRecording) {
			document.title = `🔴 Recording System Audio... - ${originalTitle}`;
			window.addEventListener("beforeunload", handleBeforeUnload);
		} else {
			document.title = originalTitle;
		}

		return () => {
			document.title = originalTitle;
			window.removeEventListener("beforeunload", handleBeforeUnload);
		};
	}, [isRecording]);

	const createMixedAudioStream = (
		sysStream: MediaStream,
		mStream: MediaStream,
	): MediaStream => {
		try {
			const ctx = new AudioContext();
			setAudioContext(ctx);

			const systemSource = ctx.createMediaStreamSource(sysStream);
			const micSource = ctx.createMediaStreamSource(mStream);

			const systemGain = ctx.createGain();
			const micGain = ctx.createGain();

			systemGain.gain.value = systemVolume / 100;
			micGain.gain.value = micVolume / 100;

			setSystemGainNode(systemGain);
			setMicGainNode(micGain);

			const destination = ctx.createMediaStreamDestination();

			systemSource.connect(systemGain);
			micSource.connect(micGain);
			systemGain.connect(destination);
			micGain.connect(destination);

			return destination.stream;
		} catch (error) {
			console.error("Audio mixing failed:", error);
			toast({
				title: "Audio Mixing Unavailable",
				description: "Recording system audio only. Browser doesn't support mixing.",
			});
			return sysStream;
		}
	};

	const startRecording = async () => {
		try {
			setPermissionDenied(false);

			const displayStream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false,
				},
			});

			const videoTrack = displayStream.getVideoTracks()[0];
			if (videoTrack) {
				videoTrack.stop();
				displayStream.removeTrack(videoTrack);
			}

			const audioTracks = displayStream.getAudioTracks();
			if (audioTracks.length === 0) {
				alert(
					"No audio track found!\\n\\n" +
					"Make sure to:\\n" +
					"1. Select a Chrome TAB (not window or screen)\\n" +
					"2. Check the 'Share tab audio' checkbox\\n" +
					"3. Choose a tab that's actually playing audio"
				);
				cleanupStreams();
				return;
			}
			const sysStream = new MediaStream(audioTracks);

			setSystemStream(sysStream);

			sysStream.getAudioTracks()[0].addEventListener("ended", () => {
				if (isRecording) {
					stopRecording();
					toast({
						title: "Screen Sharing Stopped",
						description: "Recording has been saved.",
					});
				}
			});

			let mStream: MediaStream | null = null;
			try {
				mStream = await navigator.mediaDevices.getUserMedia({
					audio: {
						deviceId: selectedDevice ? { exact: selectedDevice } : undefined,
						// @ts-expect-error - Chrome/Edge support "remote-only"
						echoCancellation: "remote-only",  
						noiseSuppression: true,   
						autoGainControl: autoGainControl,    
					},
				});

				setMicStream(mStream);
				setMicAvailable(true);
			} catch (micError) {
				console.error("Microphone permission denied:", micError);
				toast({
					title: "Microphone Unavailable",
					description: "Recording system audio only.",
				});
				setMicAvailable(false);
			}

			let streamToRecord: MediaStream;
			if (mStream) {
				streamToRecord = createMixedAudioStream(sysStream, mStream);
			} else {
				streamToRecord = sysStream;
			}

			const recorder = new MediaRecorder(streamToRecord);
			recordingChunksRef.current = [];

			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					recordingChunksRef.current.push(e.data);
				}
			};

			recorder.onstop = () => {
				const blob = new Blob(recordingChunksRef.current, {
					type: recordingChunksRef.current[0]?.type || 'audio/webm'
				});
				setRecordedBlob(blob);
				setIsRecording(false);
			};

			recorder.start(1000); 
			setMediaRecorder(recorder);

			setIsRecording(true);
			setRecordingTime(0);
			setRecordedBlob(null);
		} catch (error) {
			console.error("Failed to start recording:", error);

			if (error instanceof Error && error.name === "NotAllowedError") {
				setPermissionDenied(true);
			} else if (error instanceof Error && error.name === "NotFoundError") {
				alert(
					"The selected source doesn't support audio sharing. Please choose a tab or window with audio.",
				);
			} else {
				alert("Failed to start screen sharing. Please try again.");
			}

			cleanupStreams();
		}
	};

	const stopRecording = () => {
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.stop();
		}
		cleanupStreams();
	};

	const updateSystemVolume = (value: number[]) => {
		const vol = value[0];
		setSystemVolume(vol);
		if (systemGainNode && isRecording) {
			systemGainNode.gain.value = vol / 100;
		}
	};

	const updateMicVolume = (value: number[]) => {
		const vol = value[0];
		setMicVolume(vol);
		if (micGainNode && isRecording) {
			micGainNode.gain.value = vol / 100;
		}
	};

	const cleanupStreams = () => {
		if (systemStream) {
			systemStream.getTracks().forEach((track) => track.stop());
			setSystemStream(null);
		}
		if (micStream) {
			micStream.getTracks().forEach((track) => track.stop());
			setMicStream(null);
		}
		if (audioContext && audioContext.state !== "closed") {
			audioContext.close();
			setAudioContext(null);
		}
		setSystemGainNode(null);
		setMicGainNode(null);
		setMediaRecorder(null);
	};

	const formatTime = (timeMs: number) => {
		const minutes = Math.floor(timeMs / 60000);
		const seconds = Math.floor((timeMs % 60000) / 1000);
		return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	};

	const handleUpload = async () => {
		if (!recordedBlob) return;

		setIsUploading(true);
		try {
			await onRecordingComplete(
				recordedBlob,
				title || `System Recording ${new Date().toISOString()}`,
			);
			setRecordedBlob(null);
			setTitle("");
			setRecordingTime(0);
			onClose();
		} catch (error) {
			console.error("Failed to upload recording:", error);
			alert("Failed to upload recording");
		} finally {
			setIsUploading(false);
		}
	};

	const handleClose = () => {
		if (isRecording) {
			stopRecording();
		}
		cleanupStreams();
		setRecordedBlob(null);
		setTitle("");
		setRecordingTime(0);
		setIsRecording(false);
		setPermissionDenied(false);
		setCompatibilityError(null);
		onClose();
	};

	// Intercept open changes
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			if (isRecording) {
				setShowCloseConfirm(true);
			} else {
				handleClose();
			}
		}
	};

	if (compatibilityError) {
		return (
			<Dialog open={true} onOpenChange={(open) => {
				if (!open) {
					setCompatibilityError(null);
					onClose();
				}
			}}>
				<DialogContent className="sm:max-w-[600px]">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<MonitorSpeaker className="h-5 w-5 text-[var(--brand-solid)]" />
							Record System Audio
						</DialogTitle>
					</DialogHeader>
					<div className="flex items-center gap-3 p-4 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded-[var(--radius-card)]">
						<XCircle className="h-6 w-6 text-[var(--error)] flex-shrink-0" />
						<div>
							<h3 className="font-semibold mb-2 text-[var(--text-primary)]">
								Browser Not Supported
							</h3>
							<p className="text-sm mb-3 text-[var(--text-secondary)]">
								{compatibilityError}
							</p>
							<p className="text-xs text-[var(--text-tertiary)]">
								You can use "Record Audio" for microphone-only recording.
							</p>
						</div>
					</div>
					<div className="flex justify-end">
						<Button variant="outline" onClick={() => {
							setCompatibilityError(null);
							onClose();
						}}>
							Close
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		);
	}

	if (!isOpen) {
		return null;
	}

	if (permissionDenied && !isRecording) {
		return (
			<Dialog open={isOpen} onOpenChange={handleOpenChange}>
				<DialogContent className="sm:max-w-[600px]">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<MonitorSpeaker className="h-5 w-5 text-[var(--brand-solid)]" />
							Record System Audio
						</DialogTitle>
					</DialogHeader>

					<div className="flex items-center gap-3 p-4 bg-[var(--warning-translucent)] border border-[var(--warning-solid)]/20 rounded-[var(--radius-card)]">
						<AlertCircle className="h-6 w-6 text-[var(--warning-solid)] flex-shrink-0" />
						<div>
							<h3 className="font-semibold mb-2 text-[var(--text-primary)]">
								Screen Sharing Permission Required
							</h3>
							<p className="text-sm mb-3 text-[var(--text-secondary)]">
								You denied screen sharing permission. Please click "Try Again"
								and allow access when prompted.
							</p>
							<p className="text-xs font-medium text-[var(--warning-solid)]">
								Make sure to check "Share system audio" or "Share tab audio"
								in the browser picker!
							</p>
						</div>
					</div>

					<div className="flex justify-end gap-3">
						<Button variant="outline" onClick={handleClose}>
							Cancel
						</Button>
						<Button
							onClick={() => {
								setPermissionDenied(false);
								startRecording();
							}}
						>
							Try Again
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		);
	}

	if (recordedBlob && !isRecording) {
		return (
			<Dialog open={isOpen} onOpenChange={handleOpenChange}>
				<DialogContent className="sm:max-w-[600px]">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<MonitorSpeaker className="h-5 w-5 text-[var(--brand-solid)]" />
							Recording Complete
						</DialogTitle>
					</DialogHeader>

					<div className="space-y-6 py-4">
						<div className="flex items-center gap-3 p-4 bg-[var(--success-translucent)] border border-[var(--success-solid)]/20 rounded-[var(--radius-card)]">
							<CheckCircle className="h-5 w-5 text-[var(--success-solid)] flex-shrink-0" />
							<div>
								<h3 className="font-semibold text-[var(--text-primary)]">
									Recording Complete!
								</h3>
								<p className="text-sm text-[var(--text-secondary)]">
									Duration: {formatTime(recordingTime)}
								</p>
							</div>
						</div>

						<div className="space-y-2">
							<label className="text-sm font-medium text-[var(--text-primary)]">
								Recording Title
							</label>
							<Input
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								placeholder="Enter a title for your recording..."
							/>
						</div>

						<Button
							onClick={handleUpload}
							disabled={isUploading}
							className="w-full rounded-xl text-white cursor-pointer bg-gradient-to-r from-[#FFAB40] to-[#FF3D00] hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-orange-500/20"
						>
							{isUploading ? (
								<>
									<Loader2 className="h-5 w-5 mr-2 animate-spin" />
									Uploading...
								</>
							) : (
								<>
									<Upload className="h-5 w-5 mr-2" />
									Upload Recording
								</>
							)}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		);
	}

	if (isRecording) {
		return (
			<>
				<Dialog open={isOpen} onOpenChange={handleOpenChange}>
					<DialogContent className="sm:max-w-[700px]">
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<MonitorSpeaker className="h-5 w-5 text-[var(--brand-solid)]" />
								Recording System Audio
							</DialogTitle>
						</DialogHeader>

						<div className="space-y-6 py-4">
							<div className="flex items-center gap-3 p-4 bg-[var(--brand-light)] border border-[var(--brand-solid)]/20 rounded-[var(--radius-card)]">
								<div className="h-3 w-3 bg-[var(--error)] rounded-full animate-pulse flex-shrink-0" />
								<div>
									<h3 className="font-semibold text-[var(--text-primary)]">
										Recording System Audio{micAvailable ? " + Microphone" : " Only"}
									</h3>
									<p className="text-xs text-[var(--text-secondary)]">
										Recording continues even if you switch tabs
									</p>
								</div>
							</div>

							<div className="text-center">
								<div className="text-6xl font-mono font-bold text-[var(--text-primary)] mb-2">
									{formatTime(recordingTime)}
								</div>
								<div className="flex items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
									<div className="h-2 w-2 bg-[var(--error)] rounded-full animate-pulse" />
									<span>Recording...</span>
								</div>
							</div>

							{micAvailable && (
								<div className="grid grid-cols-2 gap-4">
									<div className="space-y-2">
										<div className="flex items-center gap-2">
											<MonitorSpeaker className="h-4 w-4 text-[var(--brand-solid)]" />
											<label className="text-sm font-medium text-[var(--text-primary)]">
												System Audio
											</label>
										</div>
										<Slider
											min={0}
											max={100}
											step={1}
											value={[systemVolume]}
											onValueChange={updateSystemVolume}
											className="cursor-pointer"
										/>
										<span className="text-xs text-[var(--text-tertiary)]">
											{systemVolume}%
										</span>
									</div>
									<div className="space-y-2">
										<div className="flex items-center gap-2">
											<Mic className="h-4 w-4 text-[var(--brand-solid)]" />
											<label className="text-sm font-medium text-[var(--text-primary)]">
												Microphone
											</label>
										</div>
										<Slider
											min={0}
											max={100}
											step={1}
											value={[micVolume]}
											onValueChange={updateMicVolume}
											className="cursor-pointer"
										/>
										<span className="text-xs text-[var(--text-tertiary)]">
											{micVolume}%
										</span>
									</div>
								</div>
							)}

							<div className="flex justify-center">
								<Button
									onClick={stopRecording}
									size="lg"
									variant="secondary"
								>
									<Square className="h-5 w-5 mr-2" />
									Stop Recording
								</Button>
							</div>
						</div>
					</DialogContent>
				</Dialog>

				<AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
					<AlertDialogContent className="bg-white dark:bg-carbon-900 border-carbon-200 dark:border-carbon-700">
						<AlertDialogHeader>
							<AlertDialogTitle className="text-carbon-900 dark:text-carbon-100">Stop Recording?</AlertDialogTitle>
							<AlertDialogDescription className="text-carbon-600 dark:text-carbon-400">
								You are currently recording system audio. Are you sure you want to close this window? Your recording will be stopped and discarded.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel 
								onClick={() => setShowCloseConfirm(false)}
								className="bg-white dark:bg-carbon-800 text-carbon-900 dark:text-carbon-100 border-carbon-300 dark:border-carbon-600 hover:bg-carbon-100 dark:hover:bg-carbon-700"
							>
								Continue Recording
							</AlertDialogCancel>
							<AlertDialogAction 
								onClick={() => {
									setShowCloseConfirm(false);
									handleClose();
								}} 
								className="bg-red-500 hover:bg-red-600 text-white"
							>
								Stop & Close
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</>
		);
	}

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[700px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<MonitorSpeaker className="h-5 w-5 text-[var(--brand-solid)]" />
						Record System Audio
					</DialogTitle>
					<DialogDescription>
						Capture system audio from your screen/tab along with your microphone
						for meeting recordings.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					<div className="p-4 bg-[var(--brand-light)] border border-[var(--brand-solid)]/20 rounded-[var(--radius-card)]">
						<h3 className="font-semibold mb-3 text-[var(--text-primary)]">
							How it works:
						</h3>
						<ol className="space-y-3 text-sm text-[var(--text-secondary)]">
							<li className="flex gap-3">
								<span className="font-bold text-[var(--brand-solid)] flex-shrink-0">1.</span>
								<span>Click "Start Recording" below</span>
							</li>
							<li className="flex gap-3">
								<span className="font-bold text-[var(--brand-solid)] flex-shrink-0">2.</span>
								<span>
									Select a <strong>Chrome Tab</strong> from the browser picker (not window or screen)
								</span>
							</li>
							<li className="flex gap-3">
								<span className="font-bold text-[var(--brand-solid)] flex-shrink-0">3.</span>
								<span>
									<strong>Check "Share tab audio"</strong> checkbox at the bottom
								</span>
							</li>
							<li className="flex gap-3">
								<span className="font-bold text-[var(--brand-solid)] flex-shrink-0">4.</span>
								<span>Allow microphone access when prompted (optional)</span>
							</li>
						</ol>
						<div className="mt-4 p-3 bg-[var(--warning-translucent)] border border-[var(--warning-solid)]/20 rounded-[var(--radius-btn)]">
							<p className="text-xs text-[var(--text-secondary)]">
								<strong>💡 Tip:</strong> Use headphones to prevent echo and ensure the best recording quality!
							</p>
						</div>
					</div>

					<div className="space-y-2">
						<label className="text-sm font-medium text-[var(--text-primary)]">
							Recording Title (Optional)
						</label>
						<Input
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Enter a title for your recording..."
							disabled={isRecording}
						/>
					</div>

					{availableDevices.length > 1 && (
						<div className="space-y-2">
							<label className="text-sm font-medium text-[var(--text-primary)]">
								Microphone
							</label>
							<DropdownMenu>
								<DropdownMenuTrigger asChild disabled={isRecording}>
									<Button
										variant="outline"
										className="w-full justify-between"
									>
										<div className="flex items-center gap-2">
											<Settings className="h-4 w-4" />
											<span className="truncate">
												{availableDevices.find(
													(d) => d.deviceId === selectedDevice,
												)?.label || `Microphone ${selectedDevice.slice(0, 8)}`}
											</span>
										</div>
										<ChevronDown className="h-4 w-4 opacity-50" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent className="w-full min-w-[400px]">
									{availableDevices.map((device) => (
										<DropdownMenuItem
											key={device.deviceId}
											onClick={() => setSelectedDevice(device.deviceId)}
											className="flex items-center gap-3 px-3 py-2 cursor-pointer"
										>
											<Mic className="h-4 w-4 text-[var(--text-tertiary)]" />
											<div className="flex-1">
												<div className="text-sm font-medium text-[var(--text-primary)]">
													{device.label ||
														`Microphone ${device.deviceId.slice(0, 8)}`}
												</div>
												<div className="text-xs text-[var(--text-tertiary)]">
													Device ID: {device.deviceId.slice(0, 20)}...
												</div>
											</div>
											{selectedDevice === device.deviceId && (
												<div className="h-2 w-2 bg-[var(--brand-solid)] rounded-full"></div>
											)}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					)}

					<div className="space-y-3">
						<label className="text-sm font-medium text-[var(--text-primary)]">
							Audio Settings
						</label>
						<div className="flex items-center justify-between p-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-card)]">
							<div className="flex-1">
								<div className="text-sm font-medium text-[var(--text-primary)]">
									Automatic Gain Control
								</div>
								<p className="text-xs text-[var(--text-tertiary)] mt-1">
									Automatically adjusts microphone volume for consistent audio levels
								</p>
							</div>
							<Switch
								id="agc-toggle"
								checked={autoGainControl}
								onCheckedChange={setAutoGainControl}
							/>
						</div>
					</div>

					<Button
						onClick={startRecording}
						size="lg"
						className="w-full rounded-xl text-white cursor-pointer bg-gradient-to-r from-[#FFAB40] to-[#FF3D00] hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-orange-500/20"
					>
						<MonitorSpeaker className="h-5 w-5 mr-2" />
						Start Recording
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
