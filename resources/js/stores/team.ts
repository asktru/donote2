import { ref } from 'vue';

export interface TeamMember {
    id: number;
    name: string;
    email: string;
}

/** The current team's members, set once from the Inertia page props. */
export const teamMembers = ref<TeamMember[]>([]);

export function setTeamMembers(members: TeamMember[]): void {
    teamMembers.value = members;
}
